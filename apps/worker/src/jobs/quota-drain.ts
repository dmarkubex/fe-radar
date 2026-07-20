import { randomUUID } from "node:crypto";
import { admitToScoring, detectPriorityFromText, drainBacklog, rollbackAdmit, type RedisEvalLike } from "@fe-radar/core";
import { getDb, items, itemAnalysis, type DbClient } from "@fe-radar/db";
import { APP_TIMEZONE, DAILY_BUDGET_PRIORITY, createLogger, dayjs } from "@fe-radar/shared";
import { FlowProducer } from "bullmq";
import { and, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";

import { enqueueItemPipeline } from "../flows";
import { createRedisConnection } from "../queues";
import { loadOwnCompanyProfile } from "../handlers/context";

const logger = createLogger({ service: "quota-drain" });

/**
 * T2（Finding #2）分布式锁：6h 周期重叠 / 手动触发会让多 worker 同时读同一批
 * pending_over_quota，各自 admitToScoring（重复扣配额）+ 各自生成 correlationId 入队
 * （重复跑 pipeline）。drain 全程持锁，复用 jobs/cluster.ts 的 SET NX PX + token
 * release 模式（仓库既有约定，不引新依赖）。
 */
export const QUOTA_DRAIN_LOCK_KEY = "quota-drain:lock";
export const QUOTA_DRAIN_LOCK_TTL_MS = 20 * 60 * 1000;
export const ACQUIRE_DRAIN_LOCK_LUA = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then
  return 1
end
return 0
`;
export const RELEASE_DRAIN_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * 获取 quota-drain 分布式锁后执行 fn；3 次重试 ×100ms。500 条按每条最坏 1s
 * （DB CAS + Redis eval + BullMQ flow + DB 补偿）约 500s，20min TTL 留出一倍以上余量。
 */
export async function withQuotaDrainLock<T>(
  redis: Pick<Redis, "eval">,
  fn: () => Promise<T>,
  ttlMs = QUOTA_DRAIN_LOCK_TTL_MS
): Promise<T> {
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const acquired = await redis.eval(ACQUIRE_DRAIN_LOCK_LUA, 1, QUOTA_DRAIN_LOCK_KEY, token, ttlMs) as number;
    if (acquired === 1) {
      try {
        return await fn();
      } finally {
        await redis.eval(RELEASE_DRAIN_LOCK_LUA, 1, QUOTA_DRAIN_LOCK_KEY, token);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Failed to acquire quota-drain lock (another worker is draining the backlog)");
}

export interface QuotaDrainResult {
  expired: number;
  readmitted: number;
  stillPending: number;
}

export interface QuotaDrainDeps {
  db?: DbClient;
  redis?: RedisEvalLike & { quit?: () => Promise<void> };
  flowProducer?: FlowProducer;
  now?: Date;
  /** 单次最多尝试再入队条数，避免 6h 窗口被 backlog 打满 */
  maxReadmit?: number;
}

/**
 * design §5.1 backlog：老化 >7 天 → dropped_quota_expired；
 * 有余量时按 FIFO 再 admitToScoring 并入队 pipeline。
 */
export async function drainPendingQuotaBacklog(deps: QuotaDrainDeps = {}): Promise<QuotaDrainResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const maxReadmit = deps.maxReadmit ?? 500;
  const businessDate = dayjs(now).tz(APP_TIMEZONE).format("YYYY-MM-DD");

  const ownsRedis = !deps.redis;
  const redis = deps.redis ?? createRedisConnection();
  const ownsFlow = !deps.flowProducer;
  const flowProducer = deps.flowProducer ?? new FlowProducer({ connection: redis as ReturnType<typeof createRedisConnection> });

  // 本公司 profile（注入 detectPriorityFromText；T4 Finding #4）
  const ownCompanyProfile = await loadOwnCompanyProfile();

  let result: QuotaDrainResult = { expired: 0, readmitted: 0, stillPending: 0 };

  try {
    result = await withQuotaDrainLock(redis as Pick<Redis, "eval">, async () => {
      // Query and ageing are part of the protected critical section; CAS remains the final
      // guard if a stale worker survives an old lock lease.
      const pending = await db
        .select({
          itemId: itemAnalysis.itemId,
          fetchedAt: items.fetchedAt,
          title: items.title,
          content: items.content,
        })
        .from(itemAnalysis)
        .innerJoin(items, eq(items.id, itemAnalysis.itemId))
        .where(eq(itemAnalysis.quotaState, "pending_over_quota"));

      if (pending.length === 0) return { expired: 0, readmitted: 0, stillPending: 0 };

      const { expiredIds, retainedIds } = drainBacklog(
        pending.map((row) => ({ itemId: row.itemId, fetchedAt: row.fetchedAt })),
        now
      );

      let expired = 0;
      if (expiredIds.length > 0) {
        const expiredRows = await db
          .update(itemAnalysis)
          .set({ quotaState: "dropped_quota_expired" })
          .where(and(
            eq(itemAnalysis.quotaState, "pending_over_quota"),
            inArray(itemAnalysis.itemId, expiredIds)
          ))
          .returning({ itemId: itemAnalysis.itemId });
        expired = expiredRows.length;
        logger.info({ expired }, "quota backlog aged out");
      }

      const retainedIdSet = new Set(retainedIds);
      const retained = pending
        .filter((row) => retainedIdSet.has(row.itemId))
        .map((row) => ({
          ...row,
          isPriority: detectPriorityFromText(row.title, row.content ?? undefined, ownCompanyProfile),
        }));
      const priorityRows = retained
        .filter((row) => row.isPriority)
        .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
      const normalRows = retained
        .filter((row) => !row.isPriority)
        .sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime());
      // Classify before truncation and reserve at most the real priority daily budget;
      // the remainder stays available to normal items, keeping the total <= maxReadmit.
      const selectedPriority = priorityRows.slice(0, Math.min(maxReadmit, DAILY_BUDGET_PRIORITY));
      const selected = selectedPriority.concat(normalRows.slice(0, maxReadmit - selectedPriority.length));

      let count = 0;
      for (const row of selected) {
        const { isPriority } = row;
        const decision = await admitToScoring(
          { itemId: row.itemId, isPriority, businessDate },
          redis as RedisEvalLike
        );

        if (decision.state !== "admitted") {
          // T3（Finding #3）：仅这一条配额耗尽，不中断循环——admitToScoring 对 normal/priority
          // 两个独立计数器分别判定（packages/core/src/quota.ts:26-34），normal 耗尽不代表 priority
          // 耗尽。原来 break 会饿死后面还有 priority 余量的高优条目。改为 continue。
          logger.info(
            { itemId: row.itemId, isPriority, state: decision.state },
            "backlog item still over quota, skip (do not break loop)"
          );
          continue;
        }

        const correlationId = randomUUID();
        let claimed = false;
        try {
          const claimedRows = await db
            .update(itemAnalysis)
            .set({ quotaState: "admitted" })
            .where(and(
              eq(itemAnalysis.itemId, row.itemId),
              eq(itemAnalysis.quotaState, "pending_over_quota")
            ))
            .returning({ itemId: itemAnalysis.itemId });
          if (claimedRows.length === 0) {
            try {
              await rollbackAdmit(decision.counterKey, redis as RedisEvalLike);
            } catch (rollbackQuotaError) {
              logger.warn({ itemId: row.itemId, error: rollbackQuotaError }, "CAS claim lost and quota rollback failed");
            }
            logger.info({ itemId: row.itemId }, "backlog item changed before CAS claim, skipped");
            continue;
          }
          claimed = true;
          await enqueueItemPipeline(flowProducer, row.itemId, correlationId);
          count += 1;
          logger.info(
            { itemId: row.itemId, correlationId, isPriority, stage: "quota-drain" },
            "backlog item readmitted to pipeline"
          );
        } catch (error) {
          const compensationErrors: unknown[] = [];
          if (claimed) {
            try {
              const revertedRows = await db
                .update(itemAnalysis)
                .set({ quotaState: "pending_over_quota" })
                .where(and(
                  eq(itemAnalysis.itemId, row.itemId),
                  eq(itemAnalysis.quotaState, "admitted")
                ))
                .returning({ itemId: itemAnalysis.itemId });
              if (revertedRows.length === 0) {
                compensationErrors.push(new Error("quotaState rollback CAS matched 0 rows"));
              }
            } catch (rollbackStateError) {
              compensationErrors.push(rollbackStateError);
            }
          }
          try {
            await rollbackAdmit(decision.counterKey, redis as RedisEvalLike);
          } catch (rollbackQuotaError) {
            compensationErrors.push(rollbackQuotaError);
          }
          logger.warn(
            { itemId: row.itemId, correlationId, error, compensationErrors },
            "backlog item claim or enqueue failed; compensation attempted"
          );
        }
      }
      return { expired, readmitted: count, stillPending: pending.length - expired - count };
    });
  } finally {
    if (ownsFlow) {
      await flowProducer.close();
    }
    if (ownsRedis && typeof redis.quit === "function") {
      await redis.quit();
    }
  }

  return result;
}
