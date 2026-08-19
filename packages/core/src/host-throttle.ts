/**
 * T-CA-01 / v1.3 design §3.4.2 — 同站 Redis 闸（NFR-313 / D-P）。
 * 同一 hostname 的出站请求硬性间隔 ≥1s：`SET key 1 PX 1000 NX` 抢到的立即放行，
 * 没抢到的按 PTTL 剩余睡眠后重试，累计超过 waitMaxMs（默认 8s）抛 FETCH_HOST_THROTTLED。
 * 不依赖 packages/db；allowlist 复用 url-guard 的 isInternalAllowlisted（禁止另维护 host 数组）。
 */

import { SourceFetchError } from "@fe-radar/shared";
import type { RedisEvalLike } from "./quota";
import { isInternalAllowlisted } from "./url-guard";

export const HOST_THROTTLE_MS = 1000;
export const HOST_THROTTLE_WAIT_MAX_MS = 8000;

/** 原子抢闸：NX 成功返回 0（已放行）；否则返回需等待的毫秒数（key 消失的竞态回退为 ARGV[1]）。 */
export const HOST_GAP_LUA = `
local ok = redis.call('SET', KEYS[1], '1', 'PX', ARGV[1], 'NX')
if ok then return 0 end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then return tonumber(ARGV[1]) end
return ttl
`;

let hostThrottleRedis: RedisEvalLike | null = null;

export function setHostThrottleRedis(redis: RedisEvalLike): void {
  hostThrottleRedis = redis;
}

/**
 * 严格 wrapper：把 ioredis `eval`（返回 unknown）收成返回 number。
 * host-throttle 新路径禁止把 ioredis 实例当 RedisEvalLike 裸 cast。
 */
export function asRedisEval(io: { eval: (...args: unknown[]) => Promise<unknown> }): RedisEvalLike {
  return {
    async eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<number> {
      const v = await io.eval(script, numberOfKeys, ...args);
      if (typeof v !== "number") {
        throw new Error("host-throttle lua must return number");
      }
      return v;
    },
  };
}

/** eval 受 remaining 约束：never-resolve 也必须在 deadline 处被切断（§3.4.2 fixture ①②）。 */
async function evalWithDeadline(redis: RedisEvalLike, key: string, remaining: number): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SourceFetchError("FETCH_HOST_THROTTLED", "host gap wait exceeded")),
      remaining
    );
  });
  try {
    return await Promise.race([redis.eval(HOST_GAP_LUA, 1, key, HOST_THROTTLE_MS), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 出站抓取前等待同站间隔。allowlist 命中直接 return（不 eval）；
 * 未 setHostThrottleRedis 则 throw（禁止 fail-open / noop）。
 */
export async function waitHostGapForUrl(url: string, opts?: { waitMaxMs?: number }): Promise<void> {
  const hostname = new URL(url).hostname.toLowerCase();
  if (isInternalAllowlisted(hostname)) return;
  if (!hostThrottleRedis) {
    throw new Error("host-throttle: setHostThrottleRedis not called");
  }
  const deadline = Date.now() + (opts?.waitMaxMs ?? HOST_THROTTLE_WAIT_MAX_MS);
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SourceFetchError("FETCH_HOST_THROTTLED", "host gap wait exceeded");
    }
    const waitMs = await evalWithDeadline(hostThrottleRedis, `fetch:host-gap:${hostname}`, remaining);
    if (waitMs <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(waitMs, deadline - Date.now())));
  }
}
