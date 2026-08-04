import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getDb,
  itemAnalysis,
  items,
  scoringReprocessRuns,
  scoringReprocessTargets
} from "@fe-radar/db";
import { admitToScoring, type RedisEvalLike } from "@fe-radar/core";
import { createDeepSeekClient, createQwenClient } from "@fe-radar/llm";
import { nowInAppTimezone } from "@fe-radar/shared";
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Redis } from "ioredis";

import { handleCuratorJob } from "../handlers/curator";
import { handlerContext } from "../handlers/context";
import { handlePrefilterJob } from "../handlers/prefilter";
import { handleScorerJob } from "../handlers/scorer";
import { createRedisConnection } from "../queues";

type TargetStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped_filter"
  | "pending_quota";

export const DEFAULT_MAX_ADMITTED = 400;
export const REPROCESS_LOCK_TTL_MS = 60_000;
export const REPROCESS_LOCK_KEY = "scoring-reprocess:lock";
export const CLAIMABLE_TARGET_STATUSES = [
  "pending",
  "failed",
  "pending_quota"
] as const;
export const RECOVERED_RUNNING_ERROR =
  "由 --recover-running 人工确认旧进程停止后恢复";
const ACQUIRE_REPROCESS_LOCK_LUA = `
if redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2]) then return 1 end
return 0
`;
const RENEW_REPROCESS_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
const RELEASE_REPROCESS_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export interface ReprocessArgs {
  runId: string;
  prepare: boolean;
  apply: boolean;
  from?: Date;
  until?: Date;
  maxAdmitted: number;
  recoverRunning: boolean;
}

export interface TargetDependencies {
  getIndustryRelated(): Promise<boolean | null>;
  clearFiltered(): Promise<void>;
  runPrefilter(): Promise<void>;
  admit(
    itemId: number,
    businessDate: string
  ): Promise<
    | { state: "admitted"; counterKey: string }
    | { state: "pending_over_quota"; counterKey: string }
  >;
  runScorer(): Promise<void>;
  runCurator(): Promise<void>;
}

export async function processReprocessTarget(
  itemId: number,
  businessDate: string,
  dependencies: TargetDependencies
): Promise<TargetStatus> {
  let isIndustryRelated = await dependencies.getIndustryRelated();
  if (isIndustryRelated == null) {
    await dependencies.runPrefilter();
    isIndustryRelated = await dependencies.getIndustryRelated();
  }

  if (isIndustryRelated === false) {
    await dependencies.clearFiltered();
    return "skipped_filter";
  }
  if (isIndustryRelated == null) {
    throw new Error("prefilter 重跑后仍为 unknown");
  }

  const decision = await dependencies.admit(itemId, businessDate);
  if (decision.state !== "admitted") return "pending_quota";

  await dependencies.runScorer();
  await dependencies.runCurator();
  return "completed";
}

export async function admitWithRunCap(
  admitted: number,
  maxAdmitted: number,
  runId: string,
  admit: () => ReturnType<TargetDependencies["admit"]>
): ReturnType<TargetDependencies["admit"]> {
  if (admitted >= maxAdmitted) {
    return {
      state: "pending_over_quota",
      counterKey: `scoring-reprocess:local-cap:${runId}`
    };
  }
  return admit();
}

export interface ReprocessLock {
  assertOwned(): void;
  release(): Promise<void>;
}

export async function acquireReprocessLock(
  redis: Pick<Redis, "eval">,
  runId: string,
  ttlMs = REPROCESS_LOCK_TTL_MS
): Promise<ReprocessLock> {
  const key = REPROCESS_LOCK_KEY;
  const token = randomUUID();
  const acquired = (await redis.eval(
    ACQUIRE_REPROCESS_LOCK_LUA,
    1,
    key,
    token,
    ttlMs
  )) as number;
  if (acquired !== 1) {
    throw new Error("已有另一个历史重算进程，请等待其结束");
  }

  let lockError: Error | null = null;
  const timer = setInterval(
    () => {
      void redis
        .eval(RENEW_REPROCESS_LOCK_LUA, 1, key, token, ttlMs)
        .then((renewed) => {
          if (renewed !== 1)
            lockError = new Error(`run_id=${runId} 重算锁已丢失`);
        })
        .catch((error: unknown) => {
          lockError = error instanceof Error ? error : new Error(String(error));
        });
    },
    Math.max(1_000, Math.floor(ttlMs / 3))
  );
  timer.unref();

  return {
    assertOwned() {
      if (lockError) throw lockError;
    },
    async release() {
      clearInterval(timer);
      await redis.eval(RELEASE_REPROCESS_LOCK_LUA, 1, key, token);
    }
  };
}

export function parseReprocessArgs(args: readonly string[]): ReprocessArgs {
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const runId = valueAfter("--run-id")?.trim();
  if (!runId) throw new Error("必须提供 --run-id");

  const prepare = args.includes("--prepare");
  const apply = args.includes("--apply");
  const recoverRunning = args.includes("--recover-running");
  if (recoverRunning && (!apply || prepare)) {
    throw new Error("--recover-running 必须单独与 --apply 使用");
  }
  const maxText = valueAfter("--max-admitted");
  const maxAdmitted = maxText == null ? DEFAULT_MAX_ADMITTED : Number(maxText);
  if (
    !Number.isInteger(maxAdmitted) ||
    maxAdmitted <= 0 ||
    maxAdmitted > 1_300
  ) {
    throw new Error("--max-admitted 必须是 1–1300 的整数");
  }
  if (!prepare) return { runId, prepare, apply, maxAdmitted, recoverRunning };

  const fromText = valueAfter("--from");
  const untilText = valueAfter("--until");
  if (!fromText || !untilText) {
    throw new Error("--prepare 必须提供固定窗口 --from <ISO> --until <ISO>");
  }
  const from = new Date(fromText);
  const until = new Date(untilText);
  if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) {
    throw new Error("--from/--until 必须是有效 ISO 时间");
  }
  if (!(from < until)) throw new Error("--from 必须早于 --until");
  return {
    runId,
    prepare,
    apply,
    from,
    until,
    maxAdmitted,
    recoverRunning
  };
}

export function wasTargetClaimed(rows: readonly { itemId: number }[]): boolean {
  return rows.length === 1;
}

export function prepareRunLockQuery(runId: string) {
  return sql`SELECT pg_advisory_xact_lock(hashtext(${runId})::bigint)`;
}

async function prepareRun(args: ReprocessArgs): Promise<void> {
  const db = getDb();
  const from = args.from!;
  const until = args.until!;
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .innerJoin(itemAnalysis, eq(itemAnalysis.itemId, items.id))
    .where(and(gte(items.publishedAt, from), lt(items.publishedAt, until)));
  const count = countRow?.count ?? 0;

  if (!args.apply) {
    console.log(
      `DRY-RUN run_id=${args.runId} from=${from.toISOString()} until=${until.toISOString()} targets=${count}`
    );
    return;
  }

  await db.transaction(async (tx) => {
    await tx.execute(prepareRunLockQuery(args.runId));
    const [existing] = await tx
      .select({
        fromAt: scoringReprocessRuns.fromAt,
        untilAt: scoringReprocessRuns.untilAt
      })
      .from(scoringReprocessRuns)
      .where(eq(scoringReprocessRuns.runId, args.runId))
      .limit(1);
    if (
      existing &&
      (existing.fromAt.getTime() !== from.getTime() ||
        existing.untilAt.getTime() !== until.getTime())
    ) {
      throw new Error(`run_id=${args.runId} 已绑定不同时间窗`);
    }
    if (existing) return;

    await tx
      .insert(scoringReprocessRuns)
      .values({ runId: args.runId, fromAt: from, untilAt: until })
      .onConflictDoNothing();
    await tx.execute(sql`
      INSERT INTO scoring_reprocess_targets (run_id, item_id)
      SELECT ${args.runId}, i.id
      FROM items i
      INNER JOIN item_analysis a ON a.item_id = i.id
      WHERE i.published_at >= ${from} AND i.published_at < ${until}
      ON CONFLICT (run_id, item_id) DO NOTHING
    `);
  });
  const preparedCounts = await readStatusCounts(args.runId);
  console.log(
    `PREPARED run_id=${args.runId} from=${from.toISOString()} until=${until.toISOString()} targets=${Object.values(preparedCounts).reduce((sum, value) => sum + value, 0)}`
  );
}

async function readStatusCounts(
  runId: string
): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({
      status: scoringReprocessTargets.status,
      count: sql<number>`count(*)::int`
    })
    .from(scoringReprocessTargets)
    .where(eq(scoringReprocessTargets.runId, runId))
    .groupBy(scoringReprocessTargets.status);
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

async function printPendingStats(runId: string): Promise<void> {
  const counts = await readStatusCounts(runId);
  const remaining =
    (counts.pending ?? 0) +
    (counts.running ?? 0) +
    (counts.failed ?? 0) +
    (counts.pending_quota ?? 0);
  console.log(
    `DRY-RUN run_id=${runId} remaining=${remaining} statuses=${JSON.stringify(counts)}`
  );
}

async function applyRun(args: ReprocessArgs): Promise<void> {
  const runId = args.runId;
  const db = getDb();
  const [run] = await db
    .select({ runId: scoringReprocessRuns.runId })
    .from(scoringReprocessRuns)
    .where(eq(scoringReprocessRuns.runId, runId))
    .limit(1);
  if (!run) throw new Error(`run_id=${runId} 尚未 prepare`);

  handlerContext.qwen = createQwenClient();
  handlerContext.deepSeek = createDeepSeekClient();
  const redis = createRedisConnection();
  let lock: ReprocessLock | undefined;
  let admitted = 0;
  let pendingQuota = 0;

  try {
    lock = await acquireReprocessLock(redis, runId);
    try {
      if (args.recoverRunning) {
        console.warn(
          `RECOVER run_id=${runId}：仅在人工确认旧重算进程已停止后执行`
        );
        const recovered = await db
          .update(scoringReprocessTargets)
          .set({
            status: "failed",
            lastError: RECOVERED_RUNNING_ERROR,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(scoringReprocessTargets.runId, runId),
              eq(scoringReprocessTargets.status, "running")
            )
          )
          .returning({ itemId: scoringReprocessTargets.itemId });
        console.log(
          `RECOVER run_id=${runId} running_to_failed=${recovered.length}`
        );
      }

      await db
        .update(scoringReprocessRuns)
        .set({ status: "running", completedAt: null })
        .where(eq(scoringReprocessRuns.runId, runId));

      const targets = await db
        .select({ itemId: scoringReprocessTargets.itemId })
        .from(scoringReprocessTargets)
        .where(
          and(
            eq(scoringReprocessTargets.runId, runId),
            inArray(scoringReprocessTargets.status, [
              ...CLAIMABLE_TARGET_STATUSES
            ])
          )
        )
        .orderBy(asc(scoringReprocessTargets.itemId));

      const businessDate = nowInAppTimezone().format("YYYY-MM-DD");
      for (const target of targets) {
        lock.assertOwned();
        const itemId = target.itemId;
        const claimed = await db
          .update(scoringReprocessTargets)
          .set({
            status: "running",
            attempts: sql`${scoringReprocessTargets.attempts} + 1`,
            lastError: null,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(scoringReprocessTargets.runId, runId),
              eq(scoringReprocessTargets.itemId, itemId),
              inArray(scoringReprocessTargets.status, [
                ...CLAIMABLE_TARGET_STATUSES
              ])
            )
          )
          .returning({ itemId: scoringReprocessTargets.itemId });
        if (!wasTargetClaimed(claimed)) continue;

        const correlationId = `reprocess:${runId}:${itemId}`;
        try {
          const status = await processReprocessTarget(itemId, businessDate, {
            async getIndustryRelated() {
              const [analysis] = await db
                .select({ value: itemAnalysis.isIndustryRelated })
                .from(itemAnalysis)
                .where(eq(itemAnalysis.itemId, itemId))
                .limit(1);
              if (!analysis)
                throw new Error(`item_id=${itemId} 缺少 item_analysis`);
              return analysis.value;
            },
            async clearFiltered() {
              await db
                .update(itemAnalysis)
                .set({
                  isCurated: false,
                  alertType: null,
                  alertLevel: null,
                  quotaState: "dropped_filter"
                })
                .where(eq(itemAnalysis.itemId, itemId));
            },
            async runPrefilter() {
              await handlePrefilterJob({ data: { itemId, correlationId } });
            },
            async admit(admitItemId, date) {
              const decision = await admitWithRunCap(
                admitted,
                args.maxAdmitted,
                runId,
                () =>
                  admitToScoring(
                    {
                      itemId: admitItemId,
                      isPriority: false,
                      businessDate: date
                    },
                    redis as unknown as RedisEvalLike
                  ).then((result) =>
                    result.state === "admitted"
                      ? { state: "admitted", counterKey: result.counterKey }
                      : {
                          state: "pending_over_quota",
                          counterKey: result.counterKey
                        }
                  )
              );
              if (decision.state === "admitted") admitted += 1;
              else pendingQuota += 1;
              return decision;
            },
            async runScorer() {
              await handleScorerJob({ data: { itemId, correlationId } });
            },
            async runCurator() {
              await handleCuratorJob({ data: { itemId, correlationId } });
            }
          });
          await db
            .update(scoringReprocessTargets)
            .set({ status, lastError: null, updatedAt: new Date() })
            .where(
              and(
                eq(scoringReprocessTargets.runId, runId),
                eq(scoringReprocessTargets.itemId, itemId)
              )
            );
        } catch (error) {
          await db
            .update(scoringReprocessTargets)
            .set({
              status: "failed",
              lastError: error instanceof Error ? error.message : String(error),
              updatedAt: new Date()
            })
            .where(
              and(
                eq(scoringReprocessTargets.runId, runId),
                eq(scoringReprocessTargets.itemId, itemId)
              )
            );
        }
      }

      const counts = await readStatusCounts(runId);
      const failed = counts.failed ?? 0;
      const unfinished =
        (counts.pending ?? 0) +
        (counts.running ?? 0) +
        (counts.pending_quota ?? 0);
      const status =
        failed > 0 ? "failed" : unfinished > 0 ? "running" : "completed";
      await db
        .update(scoringReprocessRuns)
        .set({
          status,
          completedAt: status === "completed" ? new Date() : null
        })
        .where(eq(scoringReprocessRuns.runId, runId));
      console.log(
        `APPLY run_id=${runId} admitted=${admitted} max_admitted=${args.maxAdmitted} pending_quota=${pendingQuota} statuses=${JSON.stringify(counts)}`
      );
      if (failed > 0) {
        throw new Error(
          `run_id=${runId} 有 ${failed} 个 failed target，请修复后续跑`
        );
      }
    } catch (error) {
      await db
        .update(scoringReprocessRuns)
        .set({ status: "failed", completedAt: null })
        .where(eq(scoringReprocessRuns.runId, runId));
      throw error;
    }
  } finally {
    await lock?.release();
    await redis.quit();
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const args = parseReprocessArgs(process.argv.slice(2));
  if (args.prepare) {
    await prepareRun(args);
    return;
  }
  if (args.apply) {
    await applyRun(args);
    return;
  }
  await printPendingStats(args.runId);
}

function resolveArgvPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

const isMain = Boolean(
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolveArgvPath(process.argv[1])).href
);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
