import { admitWebSearch, type RedisEvalLike } from "@fe-radar/core";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

import type { WebsearchJob } from "../queues";

const COOLDOWN_TTL_SECONDS = 86400;

export function websearchEntityCooldownKey(entityId: number): string {
  return `websearch:entity:${entityId}:24h`;
}

export interface WebsearchEnqueueTarget {
  entityId: number;
  entityName: string;
}

export interface WebsearchEnqueueConn {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, token: "EX", ttl: number): Promise<unknown>;
  decr(key: string): Promise<unknown>;
}

export interface WebsearchEnqueueQueue {
  add(name: string, data: WebsearchJob): Promise<unknown>;
}

export interface WebsearchEnqueueLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface WebsearchEnqueueDeps {
  itemId: number;
  correlationId?: string;
  conn: WebsearchEnqueueConn;
  queue: WebsearchEnqueueQueue;
  logger: WebsearchEnqueueLogger;
}

export interface WebsearchEnqueueStats {
  enqueued: number;
  skippedCooldown: number;
  skippedQuota: number;
}

/**
 * Shared websearch trigger: cooldown → admitWebSearch → enqueue → stamp cooldown.
 * Enqueue and cooldown share one guarded section; either failure DECR-rolls the quota.
 * Used by NER (T-ARK-17) and the daily sweep (T-UP-01). Do not duplicate this path.
 */
export async function enqueueWebsearchForEntities(
  targets: WebsearchEnqueueTarget[],
  deps: WebsearchEnqueueDeps,
): Promise<WebsearchEnqueueStats> {
  const stats: WebsearchEnqueueStats = {
    enqueued: 0,
    skippedCooldown: 0,
    skippedQuota: 0,
  };
  const yearMonth = dayjs().tz(APP_TIMEZONE).format("YYYY-MM");
  const redis = deps.conn as unknown as RedisEvalLike;

  for (const target of targets) {
    const cooldownKey = websearchEntityCooldownKey(target.entityId);
    if (await deps.conn.get(cooldownKey)) {
      stats.skippedCooldown += 1;
      continue;
    }

    const decision = await admitWebSearch(yearMonth, redis);
    if (decision.state === "pending_over_quota") {
      deps.logger.warn(
        { entityId: target.entityId, entityName: target.entityName, monthKey: yearMonth },
        "websearch monthly quota exhausted, discarding (no retry)",
      );
      stats.skippedQuota += 1;
      continue;
    }

    const payload: WebsearchJob = {
      entityId: target.entityId,
      entityName: target.entityName,
      itemId: deps.itemId,
      correlationId: deps.correlationId,
    };
    try {
      await deps.queue.add("websearch", payload);
      await deps.conn.set(cooldownKey, "1", "EX", COOLDOWN_TTL_SECONDS);
      deps.logger.info(
        {
          entityId: target.entityId,
          entityName: target.entityName,
          itemId: deps.itemId,
          correlationId: deps.correlationId,
        },
        "websearch enqueued for C1/C2 entity",
      );
      stats.enqueued += 1;
    } catch (enqueueError) {
      await deps.conn.decr(decision.counterKey);
      deps.logger.warn(
        { entityId: target.entityId, entityName: target.entityName, error: enqueueError },
        "websearch enqueue failed, quota rolled back",
      );
    }
  }

  return stats;
}
