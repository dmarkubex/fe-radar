/**
 * T-CA-04 / v1.3 design §3.4.2「存量测试接线」：进程内 fake Redis 实现
 * `RedisEvalLike.eval`，只识别 host-throttle 的 HOST_GAP_LUA（SET NX PX / PTTL）。
 * 文件加载时即 setHostThrottleRedis —— 禁止 env 旁路（HOST_THROTTLE_SKIP /
 * DISABLE_HOST_THROTTLE / if (process.env.VITEST) return / 无 redis 当 noop）。
 */
import { beforeEach } from "vitest";
import { HOST_GAP_LUA, setHostThrottleRedis, type RedisEvalLike } from "@fe-radar/core";

/**
 * ponytail: 时间缩放 —— 真实 HOST_THROTTLE_MS=1000 下，任何在同测试内对同一 host
 * 连发 ≥5 次的用例（如 shfe 5 天回退）会睡满 ~5s 撞 vitest 默认 5s 超时。fake 把
 * 闸间隔缩到 1/40（25ms）：第二次同 host 仍返回 ttl>0 并真实等待（非旁路），
 * 只是等待量级缩小；真实 1s 间隔语义由 packages/core host-throttle.test.ts 自带的
 * 未缩放 fake 覆盖。
 */
const CLOCK_SCALE = 40;
// key → NX 占位到期时刻（epoch ms）；语义对齐 SET key 1 PX <ttl> NX + PTTL。
const expiry = new Map<string, number>();

const fake: RedisEvalLike = {
  async eval(script, _numberOfKeys, key, px): Promise<number> {
    if (script !== HOST_GAP_LUA) {
      throw new Error(`setup-host-throttle: unrecognized lua script (${script.slice(0, 40)}…)`);
    }
    const ttlMs = Math.max(1, Math.round(Number(px) / CLOCK_SCALE));
    const now = Date.now();
    const until = expiry.get(String(key));
    // SET NX：无 key 或已过期 → 抢到，返回 0；否则返回 PTTL 剩余（>0 需等待）。
    if (until === undefined || until <= now) {
      expiry.set(String(key), now + ttlMs);
      return 0;
    }
    return until - now;
  }
};

setHostThrottleRedis(fake);

// 各测试隔离：每个用例首次 SET NX 立即成功；用例内部第二次同 host 仍返回 ttl>0。
beforeEach(() => {
  expiry.clear();
});
