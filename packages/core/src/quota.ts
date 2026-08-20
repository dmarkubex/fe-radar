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

// v1.2 — websearch 月度限额（豆包搜索 1000 次/月）
export const WEBSEARCH_MONTHLY_BUDGET = 1000;
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

// T-SEC-08 / S2 — 本地凭据登录失败计数器。
// 双独立计数器（username 一个、IP 一个，IP 可选），任一达上限即锁。
// admit 在单个 Lua 脚本里原子「读两键 → 超限拒 → 否则双 INCR + TTL」预占，
// 消除 bcrypt 前 check-then-act 竞态（20/100 并发错误密码最多放行 LOGIN_FAIL_LIMIT 次）。
// 成功登录必须 rollback（双 DECR，禁止 DEL，以免清掉同 IP 其他 username 的计数）。
// 失败保留预占，不再二次 INCR。键空间 login:fail:* 与 scoring:counter:* 完全隔离。
export const LOGIN_FAIL_LIMIT = 5;
export const LOGIN_FAIL_TTL_SECONDS = 15 * 60; // 15 分钟冷却

export const LOGIN_FAIL_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return current
`;

/**
 * 原子预占：读 KEYS（1=username，可选 2=ip）→ 任一 >= limit 返回 0；
 * 否则各 INCR，首次设 TTL，返回 1。bcrypt 前调用；失败保留计数，成功走 LOGIN_ROLLBACK_LUA。
 * ARGV[1]=limit，ARGV[2]=ttl。支持 numberOfKeys=1（仅 username）或 2（username+ip）。
 */
export const LOGIN_ADMIT_LUA = `
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local u = tonumber(redis.call('GET', KEYS[1]) or '0')
local i = 0
if #KEYS >= 2 then
  i = tonumber(redis.call('GET', KEYS[2]) or '0')
end
if u >= limit or i >= limit then
  return 0
end
local un = redis.call('INCR', KEYS[1])
if un == 1 then redis.call('EXPIRE', KEYS[1], ttl) end
if #KEYS >= 2 then
  local in_ = redis.call('INCR', KEYS[2])
  if in_ == 1 then redis.call('EXPIRE', KEYS[2], ttl) end
end
return 1
`;

/**
 * 登录成功回滚本次预占：两键各 DECR（仅当 >0），绝不 DEL。
 * 支持 numberOfKeys=1 或 2，与 LOGIN_ADMIT_LUA 对称。
 */
export const LOGIN_ROLLBACK_LUA = `
local function safeDecr(key)
  local c = tonumber(redis.call('GET', key) or '0')
  if c > 0 then
    redis.call('DECR', key)
  end
end
safeDecr(KEYS[1])
if #KEYS >= 2 then
  safeDecr(KEYS[2])
end
return 1
`;

/**
 * 兼容旧路径：失败时原子 INCR 双键。新流程由 LOGIN_ADMIT_LUA 预占，失败勿再调本脚本（会双计）。
 */
export const LOGIN_FAIL_BOTH_LUA = `
local ttl = tonumber(ARGV[1])
local u = redis.call('INCR', KEYS[1])
if u == 1 then redis.call('EXPIRE', KEYS[1], ttl) end
if #KEYS >= 2 then
  local i = redis.call('INCR', KEYS[2])
  if i == 1 then redis.call('EXPIRE', KEYS[2], ttl) end
end
return 1
`;

/** 登录失败计数键（按维度：username 或 ip）。与 scoring:counter:* 隔离。 */
export function loginFailKey(dimension: "username" | "ip", value: string): string {
  return `login:fail:${dimension}:${value}`;
}

/** 兼容旧调用（subject 形如 username|ip）—— 仅用于过渡。 */
export function loginFailKeyLegacy(subject: string): string {
  return `login:fail:${subject}`;
}

/**
 * bcrypt 前原子预占。ip=null 时仅 username 维度（跳过 IP，不写 unknown 共享键）。
 * 返回 true = 放行（已 INCR），false = 已锁。Redis 不可达时 fail-open（true）。
 */
export async function admitLoginAttempt(
  username: string,
  ip: string | null,
  redis: RedisEvalLike
): Promise<boolean> {
  try {
    const uKey = loginFailKey("username", username);
    if (ip) {
      const iKey = loginFailKey("ip", ip);
      const admitted = await redis.eval(
        LOGIN_ADMIT_LUA,
        2,
        uKey,
        iKey,
        LOGIN_FAIL_LIMIT,
        LOGIN_FAIL_TTL_SECONDS
      );
      return admitted > 0;
    }
    const admitted = await redis.eval(
      LOGIN_ADMIT_LUA,
      1,
      uKey,
      LOGIN_FAIL_LIMIT,
      LOGIN_FAIL_TTL_SECONDS
    );
    return admitted > 0;
  } catch {
    return true; // fail-open
  }
}

/**
 * 登录成功：回滚本次预占（双 DECR）。ip=null 时仅回滚 username。
 * Redis 不可达时 fail-open（吞错）。
 */
export async function rollbackLoginAdmit(
  username: string,
  ip: string | null,
  redis: RedisEvalLike
): Promise<void> {
  try {
    const uKey = loginFailKey("username", username);
    if (ip) {
      const iKey = loginFailKey("ip", ip);
      await redis.eval(LOGIN_ROLLBACK_LUA, 2, uKey, iKey);
      return;
    }
    await redis.eval(LOGIN_ROLLBACK_LUA, 1, uKey);
  } catch {
    // fail-open
  }
}

/**
 * 兼容：原子 INCR username + 可选 ip。新登录路径失败时不要调用（admit 已预占）。
 */
export async function recordLoginFailureBoth(
  username: string,
  ip: string | null,
  redis: RedisEvalLike
): Promise<void> {
  try {
    const uKey = loginFailKey("username", username);
    if (ip) {
      const iKey = loginFailKey("ip", ip);
      await redis.eval(LOGIN_FAIL_BOTH_LUA, 2, uKey, iKey, LOGIN_FAIL_TTL_SECONDS);
      return;
    }
    await redis.eval(LOGIN_FAIL_BOTH_LUA, 1, uKey, LOGIN_FAIL_TTL_SECONDS);
  } catch {
    // fail-open
  }
}

/**
 * 记录一次登录失败（单键 INCR，legacy subject）。仅兼容旧调用点。
 */
export async function recordLoginFailure(subject: string, redis: RedisEvalLike): Promise<number> {
  try {
    const key = loginFailKeyLegacy(subject);
    return await redis.eval(LOGIN_FAIL_LUA, 1, key, 0, LOGIN_FAIL_TTL_SECONDS);
  } catch {
    return 0;
  }
}

/**
 * 查询当前 subject 的失败计数（legacy 单键）。
 * Redis 不可达时返回 0（fail-open）。
 */
export async function getLoginFailCount(subject: string, redis: RedisEvalLike): Promise<number> {
  try {
    const key = loginFailKeyLegacy(subject);
    const count = await redis.eval(
      "return tonumber(redis.call('GET', KEYS[1]) or '0')",
      1,
      key
    );
    return count;
  } catch {
    return 0;
  }
}
