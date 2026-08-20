import { randomUUID } from "node:crypto";

import { entities, getDb, sources } from "@fe-radar/db";
import { createLogger } from "@fe-radar/shared";
import { and, eq, inArray } from "drizzle-orm";

import { createRedisConnection, createWebsearchQueue } from "../queues";
import {
  enqueueWebsearchForEntities,
  type WebsearchEnqueueConn,
  type WebsearchEnqueueLogger,
  type WebsearchEnqueueQueue,
  type WebsearchEnqueueStats,
} from "./websearch-enqueue";

const logger = createLogger({ service: "websearch-sweep" });

export const WEBSEARCH_SWEEP_SOURCE_ID = 148;
export const WEBSEARCH_SWEEP_CURSOR_KEY = "websearch:sweep:cursor";
/** Sweep has no triggering item. handleWebsearchJob only logs this as triggerItemId. */
export const WEBSEARCH_SWEEP_SENTINEL_ITEM_ID = 0;

export interface WebsearchSweepConfig {
  enabled: boolean;
  maxPerRun: number;
  circles: string[];
}

export interface WebsearchSweepResult {
  scanned: number;
  enqueued: number;
  skippedCooldown: number;
  skippedQuota: number;
  cursor: number;
}

export interface WebsearchSweepRedis extends WebsearchEnqueueConn {
  quit(): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  set(key: string, value: string, token: "EX", ttl: number): Promise<unknown>;
}

export interface WebsearchSweepQueue extends WebsearchEnqueueQueue {
  close(): Promise<unknown>;
}

export interface WebsearchSweepDeps {
  db?: ReturnType<typeof getDb>;
  conn?: WebsearchSweepRedis;
  queue?: WebsearchSweepQueue;
  enqueue?: typeof enqueueWebsearchForEntities;
  logger?: WebsearchEnqueueLogger & { error(obj: object, msg: string): void };
  correlationId?: string;
}

export function parseSweepConfig(config: unknown): WebsearchSweepConfig | null {
  if (config == null || typeof config !== "object") return null;
  const sweep = (config as Record<string, unknown>).sweep;
  if (sweep == null || typeof sweep !== "object") return null;
  const raw = sweep as Record<string, unknown>;
  const maxPerRun = Number(raw.maxPerRun);
  const circles = Array.isArray(raw.circles)
    ? raw.circles.filter((circle): circle is string => typeof circle === "string" && circle.length > 0)
    : [];
  if (!Number.isInteger(maxPerRun) || maxPerRun <= 0) {
    return { enabled: false, maxPerRun: 0, circles };
  }
  return {
    enabled: raw.enabled === true,
    maxPerRun,
    circles,
  };
}

function emptyResult(cursor = 0): WebsearchSweepResult {
  return { scanned: 0, enqueued: 0, skippedCooldown: 0, skippedQuota: 0, cursor };
}

function mergeStats(
  scanned: number,
  cursor: number,
  stats: WebsearchEnqueueStats,
): WebsearchSweepResult {
  return {
    scanned,
    enqueued: stats.enqueued,
    skippedCooldown: stats.skippedCooldown,
    skippedQuota: stats.skippedQuota,
    cursor,
  };
}

function rotateSlice<T>(items: T[], start: number, count: number): T[] {
  const selected: T[] = [];
  for (let i = 0; i < count; i += 1) {
    selected.push(items[(start + i) % items.length]!);
  }
  return selected;
}

function parseCursor(raw: string | null, total: number): number {
  const parsed = Number.parseInt(raw ?? "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed % total;
}

/**
 * Daily fallback sweep: rotate C1+C2 company entities and enqueue websearch
 * for those not in 24h cooldown. Failures must not throw (scheduler stays up).
 */
export async function runWebsearchSweep(deps: WebsearchSweepDeps = {}): Promise<WebsearchSweepResult> {
  const log = deps.logger ?? logger;
  try {
    const db = deps.db ?? getDb();
    const [source] = await db
      .select({ config: sources.config })
      .from(sources)
      .where(eq(sources.id, WEBSEARCH_SWEEP_SOURCE_ID))
      .limit(1);

    const config = parseSweepConfig(source?.config);
    if (!config || !config.enabled || config.circles.length === 0) {
      const result = emptyResult();
      log.info(result, "websearch sweep completed");
      return result;
    }

    const companyEntities = await db
      .select({
        entityId: entities.id,
        entityName: entities.canonicalName,
      })
      .from(entities)
      .where(and(eq(entities.type, "company"), inArray(entities.circle, config.circles)))
      .orderBy(entities.id);

    if (companyEntities.length === 0) {
      const result = emptyResult();
      log.info(result, "websearch sweep completed");
      return result;
    }

    const ownedConn = deps.conn == null ? createRedisConnection() : null;
    const conn = deps.conn ?? (ownedConn as unknown as WebsearchSweepRedis);
    const ownedQueue = deps.queue == null && ownedConn != null ? createWebsearchQueue(ownedConn) : null;
    const queue = deps.queue ?? (ownedQueue as unknown as WebsearchSweepQueue);
    try {
      const start = parseCursor(await conn.get(WEBSEARCH_SWEEP_CURSOR_KEY), companyEntities.length);
      const scanned = Math.min(config.maxPerRun, companyEntities.length);
      const selected = rotateSlice(companyEntities, start, scanned);
      const nextCursor = (start + scanned) % companyEntities.length;

      const stats = await (deps.enqueue ?? enqueueWebsearchForEntities)(selected, {
        itemId: WEBSEARCH_SWEEP_SENTINEL_ITEM_ID,
        correlationId: deps.correlationId ?? randomUUID(),
        conn,
        queue,
        logger: log,
      });

      await conn.set(WEBSEARCH_SWEEP_CURSOR_KEY, String(nextCursor));
      const result = mergeStats(scanned, nextCursor, stats);
      log.info(result, "websearch sweep completed");
      return result;
    } finally {
      if (ownedQueue) await ownedQueue.close();
      if (ownedConn) await ownedConn.quit();
    }
  } catch (error) {
    log.error({ error }, "websearch sweep failed");
    return emptyResult();
  }
}
