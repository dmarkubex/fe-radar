import type { OAuthConfig } from "next-auth/providers";

export interface DingtalkProfile {
  unionid: string;
  name: string;
  dept?: string | null;
}

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
    token: "https://api.dingtalk.com/v1.0/oauth2/userAccessToken",
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
