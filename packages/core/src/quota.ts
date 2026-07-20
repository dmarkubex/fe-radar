import { DAILY_BUDGET_NORMAL, DAILY_BUDGET_PRIORITY } from "@fe-radar/shared";
import type { QuotaDecision, QuotaInput } from "./types";

export const QUOTA_TTL_SECONDS = 90_000;

export const ADMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return current
`;

export const ROLLBACK_ADMIT_LUA = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  redis.call('DECR', KEYS[1])
end
return 1
`;

export interface RedisEvalLike {
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<number>;
}

export function quotaKey(kind: "normal" | "priority", businessDate: string): string {
  return `scoring:counter:${kind}:${businessDate}`;
}

export async function admitToScoring(input: QuotaInput, redis: RedisEvalLike): Promise<QuotaDecision> {
  const kind = input.isPriority ? "priority" : "normal";
  const limit = input.isPriority ? DAILY_BUDGET_PRIORITY : DAILY_BUDGET_NORMAL;
  const counterKey = quotaKey(kind, input.businessDate);
  const admitted = await redis.eval(ADMIT_LUA, 1, counterKey, limit, QUOTA_TTL_SECONDS);

  return admitted > 0
    ? { state: "admitted", counterKey }
    : { state: "pending_over_quota", counterKey };
}

export async function rollbackAdmit(counterKey: string, redis: RedisEvalLike): Promise<void> {
  await redis.eval(ROLLBACK_ADMIT_LUA, 1, counterKey);
}

export interface BacklogCandidate {
  itemId: number;
  fetchedAt: Date;
}

export interface BacklogDrainResult {
  expiredIds: number[];
  retainedIds: number[];
}

export function drainBacklog(items: BacklogCandidate[], now = new Date(), maxAgeDays = 7): BacklogDrainResult {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const expiredIds: number[] = [];
  const retainedIds: number[] = [];

  for (const item of items) {
    if (now.getTime() - item.fetchedAt.getTime() > maxAgeMs) {
      expiredIds.push(item.itemId);
    } else {
      retainedIds.push(item.itemId);
    }
  }

  return { expiredIds, retainedIds };
}

// v1.2 — websearch 月度限额（豆包搜索 500 次/月）
export const WEBSEARCH_MONTHLY_BUDGET = 500;
export const WEBSEARCH_TTL_SECONDS = 32 * 24 * 60 * 60; // 32 天，覆盖最长月

export function websearchQuotaKey(yearMonth: string): string {
  return `websearch:counter:${yearMonth}`;
}

export async function admitWebSearch(yearMonth: string, redis: RedisEvalLike): Promise<QuotaDecision> {
  const counterKey = websearchQuotaKey(yearMonth);
  const admitted = await redis.eval(ADMIT_LUA, 1, counterKey, WEBSEARCH_MONTHLY_BUDGET, WEBSEARCH_TTL_SECONDS);

  return admitted > 0
    ? { state: "admitted", counterKey }
    : { state: "pending_over_quota", counterKey };
}
