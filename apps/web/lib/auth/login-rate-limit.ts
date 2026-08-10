/**
 * T-SEC-08 / S2 / A-4: 本地凭据登录失败计数 / 锁定。
 *
 * - 双独立计数器（username / 可选 IP），任一达上限即锁。
 * - bcrypt 前原子预占（LOGIN_ADMIT_LUA：读→超限拒→否则 INCR）；失败保留预占；
 *   成功 rollbackLoginAdmit 双 DECR（禁止 DEL，以免清掉同 IP 其他 username 计数）。
 * - **IP 维度（A-4 方案 b）**：
 *   - 仅 `TRUST_PROXY_HEADERS=true` 时信任 X-Forwarded-For 并启用 IP 限速。
 *   - Auth.js `authorize()` 入参是标准 Web `Request`，**没有 peer IP**；
 *     Next.js 15 的 `NextRequest` 也已移除 `.ip`。在 authorize 内读 peer 永远为 null。
 *   - 当前部署（Swarm published port 直发、无重写 XFF 的可信反代）→ 默认关闭
 *     TRUST_PROXY_HEADERS → **IP 维度不可用**（仅 username 限速）。不是 bug 伪装：
 *     代码路径明确在 trust 关闭且无 peer 时返回 null 并跳过 IP 键。
 *   - 启用条件：前置 Nginx/CDN 等会正确追加/重写 XFF 的可信代理后，显式设
 *     `TRUST_PROXY_HEADERS=true`（可选 `TRUSTED_PROXY_HOPS`，默认 1）。
 *   - 绝不回退共享 `"unknown"` 键。
 * - fail-open：Redis 不可达时放行（避免 Redis 故障锁死全员）。
 */
import IORedis from "ioredis";
import {
  admitLoginAttempt,
  rollbackLoginAdmit as coreRollbackLoginAdmit,
  type RedisEvalLike
} from "@fe-radar/core";
import { webLogger } from "@/lib/logger";

let client: IORedis | null = null;

/**
 * 延迟建一个 bounded ioredis（仿 worker-monitor-query.ts：短 connectTimeout + 不重试），
 * 避免本地登录默认打开时拖慢无 Redis 的本地 dev。
 */
function getClient(): RedisEvalLike | null {
  if (process.env.DISABLE_LOGIN_RATE_LIMIT === "true") {
    return null;
  }
  if (client) {
    return client as unknown as RedisEvalLike;
  }
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    const inst = new IORedis(url, {
      connectTimeout: 3000,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });
    inst.on("error", (err) => {
      webLogger.warn({ err }, "login-rate-limit redis error");
    });
    // 连接关闭（Redis 重启 / 网络中断；retryStrategy 不重连）后清空模块级引用，
    // 下次 getClient() 会新建一个全新连接，而不是无限复用这个已 end 的死实例。
    // 这样 fail-open 只在真正故障期间生效；Redis 恢复后下一次请求即重建连接、限速自动恢复。
    // retryStrategy 仍返回 null（不自动重连），避免 Redis 长期不可达时不断重试拖慢请求。
    inst.on("end", () => {
      if (client === inst) client = null;
    });
    client = inst;
    return inst as unknown as RedisEvalLike;
  } catch {
    return null;
  }
}

/** 是否信任代理写入的 X-Forwarded-For（默认 false）。 */
export function isTrustProxyHeaders(): boolean {
  return process.env.TRUST_PROXY_HEADERS === "true";
}

/**
 * 从 x-forwarded-for 取可信客户端 IP（仅 TRUST_PROXY_HEADERS=true 时使用）。
 * 追加式代理（Nginx `$proxy_add_x_forwarded_for`）把每一跳 peer 追加到**右侧**，
 * 客户端可伪造的部分在最左；取从右数第 TRUSTED_PROXY_HOPS 项（默认 1）。
 * 条目不足 hops 时取最左。XFF 空 → null（不返回 "unknown"）。
 */
export function trustedClientIp(xForwardedFor: string | null | undefined): string | null {
  if (!xForwardedFor) return null;
  const parts = xForwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const hopsRaw = Number(process.env.TRUSTED_PROXY_HOPS ?? "1");
  const hops = Number.isInteger(hopsRaw) && hopsRaw >= 1 ? hopsRaw : 1;
  const idx = Math.max(0, parts.length - hops);
  const ip = parts[idx];
  if (!ip || ip === "unknown") return null;
  return ip;
}

/**
 * 解析登录限速用的客户端 IP。
 * - TRUST_PROXY_HEADERS=true：优先 XFF（右侧可信跳），否则可选 peer；都没有 → null（跳过 IP 维度）。
 * - 默认关闭：忽略 XFF（防伪造）。Auth.js 路径应传 peer=null（A-4：Web Request 无 peer）。
 *   若调用方有真实 peer（非 authorize 路径）可传入；取不到 → null。绝不写共享 "unknown" 键。
 */
export function resolveLoginClientIp(
  xForwardedFor: string | null | undefined,
  peerAddress?: string | null | undefined
): string | null {
  const peer = typeof peerAddress === "string" ? peerAddress.trim() : "";
  const safePeer = peer && peer !== "unknown" ? peer : null;

  if (isTrustProxyHeaders()) {
    return trustedClientIp(xForwardedFor) ?? safePeer;
  }
  // 默认不信任 XFF；无 peer 时 IP 维度关闭（当前登录路径常态）
  return safePeer;
}

/**
 * bcrypt 前原子预占。ip=null 时仅 username 维度。
 * 返回 true = 放行（已占坑），false = 已锁。Redis 不可达 / 关闭限速时 fail-open。
 */
export async function admitLogin(username: string, ip: string | null): Promise<boolean> {
  const redis = getClient();
  if (!redis) return true;
  const u = username.trim().toLowerCase();
  try {
    return await admitLoginAttempt(u, ip, redis);
  } catch (err) {
    webLogger.warn({ err, username: u, ip }, "login admit failed (fail-open)");
    return true;
  }
}

/**
 * 登录成功：回滚本次预占（DECR）。失败路径不要调用（保留计数）。
 */
export async function rollbackLoginAdmit(username: string, ip: string | null): Promise<void> {
  const redis = getClient();
  if (!redis) return;
  const u = username.trim().toLowerCase();
  try {
    await coreRollbackLoginAdmit(u, ip, redis);
  } catch (err) {
    webLogger.warn({ err, username: u, ip }, "login admit rollback failed (fail-open)");
  }
}

/**
 * @deprecated S2 起失败由 admit 预占保留，勿再调用（会双计）。保留 export 以免外部误引用编译断。
 * 新路径请：admitLogin →（失败 keep / 成功 rollbackLoginAdmit）。
 */
export async function recordFailedLogin(username: string, ip: string | null): Promise<void> {
  // 有意 no-op：预占模型下失败不再二次 INCR。
  void username;
  void ip;
}
