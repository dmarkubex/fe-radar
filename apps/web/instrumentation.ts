/**
 * T-SEC-16 / S5 / S6: 生产 origin 断言放在 instrumentation register，
 * 而不是 auth.ts 模块顶层 —— 后者会在 next build 的 page-data 收集阶段（NODE_ENV=production）
 * 触发，本地 http origin 会让构建直接挂。register 在 Next.js 服务实例 bootstrap 时运行。
 *
 * S6：去掉对 NEXT_PHASE 的依赖。Next.js 15 全仓仅在 build 阶段赋值
 * PHASE_PRODUCTION_BUILD，从未赋值 "phase-production-server"，故原门控为死代码。
 * 现以 NODE_ENV === "production" 作为启动校验门控。
 *
 * S5 方案 (a)：内网 only 部署允许 http origin（当前生产即 http://10.1.20.156:3013）。
 * 要求非空且为合法 http/https 绝对 URL；http 时 WARN + 强制 useSecureCookie=false
 * （与 auth.ts 从 URL 推导一致）。HTTPS 硬性要求推迟到外网切换，由
 * docs/runbook/external-https-deployment.md 约束。
 *
 * Next.js 官方启动钩子；需在 next.config 不显式禁用 instrumentationHook（默认开）。
 */

import { createLogger } from "@fe-radar/shared";

const logger = createLogger({ service: "web-instrumentation" });

export type AuthOriginPolicy = {
  authUrl: string;
  /** false when origin is missing or non-https (http / 其他 scheme 均 false) */
  useSecureCookie: boolean;
  /** true when origin is present but not https */
  httpOrigin: boolean;
};

/**
 * A-7: 取 AUTH_URL / NEXTAUTH_URL 中第一个 trim 后非空的值。
 * `??` 只在 null/undefined 时回退，空字符串 `""` 会遮蔽有效的 NEXTAUTH_URL
 * （Portainer 遗留 AUTH_URL="" 时导致启动校验误抛、容器重启循环）。
 * 与 auth.ts 内联同语义保持一致。
 */
export function resolveConfiguredAuthUrl(
  authUrl: string | undefined = process.env.AUTH_URL,
  nextAuthUrl: string | undefined = process.env.NEXTAUTH_URL
): string {
  for (const v of [authUrl, nextAuthUrl]) {
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return "";
}

/**
 * 纯函数：从 AUTH_URL / NEXTAUTH_URL 推导 cookie secure 策略。
 * 与 apps/web/auth.ts 的推导对齐：仅 https:// 前缀才 secure。
 */
export function resolveAuthOriginPolicy(authUrl: string): AuthOriginPolicy {
  const trimmed = authUrl.trim();
  const useSecureCookie = trimmed.startsWith("https://");
  const httpOrigin = trimmed.length > 0 && !useSecureCookie;
  return { authUrl: trimmed, useSecureCookie, httpOrigin };
}

/**
 * 判定 AUTH_URL 是否为合法的 http/https 绝对 URL。
 * 用 WHATWG URL 解析，不靠前缀字符串判断（避免 "https:evil" 等假阳性）。
 */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function register(): Promise<void> {
  // 仅生产环境校验；开发跳过。不依赖 NEXT_PHASE（该变量运行时从不等于 phase-production-server）。
  if (process.env.NODE_ENV === "production") {
    const authUrl = resolveConfiguredAuthUrl();
    if (!authUrl) {
      throw new Error(
        "生产环境 AUTH_URL/NEXTAUTH_URL 不能为空。请在 Portainer 环境变量填实际访问 origin（内网可 http://…，外网必须 https://…）。"
      );
    }

    if (!isAbsoluteHttpUrl(authUrl)) {
      throw new Error(
        "生产环境 AUTH_URL/NEXTAUTH_URL 必须是合法的 http/https 绝对 URL（例如 http://10.1.20.156:3013 或 https://radar.example.com）。"
      );
    }

    const policy = resolveAuthOriginPolicy(authUrl);
    if (policy.httpOrigin) {
      // 强制 Secure cookie 关闭：auth.ts 已从 URL 推导 false；再写 env 供运维/旁路读取一致。
      // http 下 Secure cookie 发不出去，必须与 origin 一致，否则会话无法建立。
      process.env.AUTH_COOKIE_SECURE = "false";
      logger.warn(
        {
          authUrl: policy.authUrl,
          useSecureCookie: false,
          event: "auth_http_origin_in_production"
        },
        "生产环境使用非 HTTPS origin：已强制 useSecureCookie=false。切外网前须按 docs/runbook/external-https-deployment.md 配置 HTTPS。"
      );
    }
  }
}
