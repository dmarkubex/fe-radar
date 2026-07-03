import type { OAuthConfig } from "next-auth/providers";
import { customFetch } from "next-auth";

export interface DingtalkProfile {
  unionid: string;
  name: string;
  dept?: string | null;
}

const TOKEN_ENDPOINT = "https://api.dingtalk.com/v1.0/oauth2/userAccessToken";

export function isDingtalkEnabled(): boolean {
  return process.env.DINGTALK_ENABLED === "true";
}

/**
 * Local credential login policy (Antigravity #1 — emergency break-glass control).
 *
 * - DingTalk disabled (M0–M3): local accounts are the only login method → always allowed.
 * - DingTalk enabled (M4+): local login is **emergency-only** and must be explicitly
 *   unlocked via `EMERGENCY_LOCAL_LOGIN=true`. Without it, the credentials provider
 *   rejects the login at the `authorize` layer AND the UI hides the local entry — the
 *   "仅供运维应急" wording is no longer the only control.
 */
export function isLocalLoginAllowed(): boolean {
  if (!isDingtalkEnabled()) return true;
  return process.env.EMERGENCY_LOCAL_LOGIN === "true";
}

export function DingtalkProvider(): OAuthConfig<DingtalkProfile> {
  return {
    id: "dingtalk",
    name: "钉钉",
    type: "oauth",
    checks: ["state"],
    clientId: process.env.DINGTALK_APP_KEY,
    clientSecret: process.env.DINGTALK_APP_SECRET,
    authorization: {
      url: "https://login.dingtalk.com/oauth2/auth",
      params: {
        response_type: "code",
        scope: "openid"
      }
    },
    token: {
      // 钉钉 userAccessToken 端点不符合 OAuth2 规范：要求 JSON body + camelCase 字段
      // （clientId/clientSecret/grantType/code），且只接受 application/json。
      // 注意：@auth/core@0.41.0 的 OAuth callback **不会调用 token.request**，
      // token 交换实际由 oauth4webapi.authorizationCodeGrantRequest() 按 OAuth2 标准发起
      // （form-encoded + client_secret_basic header），钉钉直接返回 400 → CallbackRouteError。
      // 唯一可行的拦截点是 callback.ts 内部的 [o.customFetch] 包装器：它在真正 fetch 前
      // 调用 provider[customFetch]，且 args[1].body 是含 code 的 URLSearchParams。
      // 在此反解 code，改发钉钉要求的 JSON，并把 camelCase 响应映射为 Auth.js 期望的 snake_case。
      url: TOKEN_ENDPOINT,
      // 兜底：oauth4webapi 仍会发出标准请求（钉钉返回 400），这里把 400 的错误体
      // 压成一个能让流程继续的合法响应；真正有效的 token 由 [customFetch] 注入。
      async conform(response: Response) {
        if (!response.ok) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 200,
            headers: { "content-type": "application/json" }
          });
        }
        return response;
      }
    },
    // 核心拦截：在 oauth4webapi 发出标准 OAuth2 token 请求前改写成钉钉的 JSON 协议。
    // callback.ts:169 的包装器签名 (...args) => fetch(args)，args[0]=url，args[1]=RequestInit。
    [customFetch]: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      // 只接管 token 端点；userinfo 等走默认 fetch（userinfo 已有独立 request 处理）
      if (!url.includes("/oauth2/userAccessToken") || !init?.body) {
        return fetch(input, init);
      }
      // init.body 是 oauth4webapi 构造的 URLSearchParams 对象：grant_type=authorization_code&code=xxx&...
      // （oauth4webapi@3.8.6 authenticated_request 直接把 URLSearchParams 实例作为 body 传入）
      const formBody =
        init.body instanceof URLSearchParams
          ? init.body
          : new URLSearchParams(String(init.body));
      const code = formBody.get("code");
      if (!code) {
        throw new Error("DingTalk token exchange: authorization code missing in request body");
      }
      const tokenResponse = await fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: process.env.DINGTALK_APP_KEY,
          clientSecret: process.env.DINGTALK_APP_SECRET,
          grantType: "authorization_code",
          code
        })
      });
      if (!tokenResponse.ok) {
        const detail = await tokenResponse.text().catch(() => "");
        throw new Error(`DingTalk token exchange failed: ${tokenResponse.status} ${detail}`);
      }
      const raw = (await tokenResponse.json()) as Record<string, unknown>;
      // 钉钉返回 camelCase（accessToken/expireIn）→ 映射为 oauth4webapi 期望的 snake_case，
      // 包成合法的 OAuth2 Token Endpoint 响应，供 processAuthorizationCodeResponse 校验通过。
      const mapped: Record<string, unknown> = {
        access_token: raw.accessToken,
        refresh_token: raw.refreshToken,
        expires_in: raw.expireIn,
        token_type: "Bearer"
      };
      return new Response(JSON.stringify(mapped), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    userinfo: {
      url: "https://api.dingtalk.com/v1.0/contact/users/me",
      async request({ tokens }: { tokens: { access_token?: unknown } }) {
        const response = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
          headers: { "x-acs-dingtalk-access-token": String(tokens.access_token ?? "") }
        });
        if (!response.ok) {
          throw new Error("DingTalk userinfo failed");
        }
        const raw = await response.json() as Record<string, unknown>;
        return {
          unionid: String(raw.unionId ?? raw.unionid ?? raw.openId ?? ""),
          name: String(raw.name ?? raw.nick ?? "钉钉用户"),
          dept: typeof raw.dept === "string" ? raw.dept : null
        };
      }
    },
    profile(profile) {
      return {
        id: profile.unionid,
        name: profile.name,
        email: `${profile.unionid}@dingtalk.fe-radar.local`
      };
    }
  };
}
