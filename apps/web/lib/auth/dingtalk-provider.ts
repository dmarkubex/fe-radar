import type { OAuthConfig } from "next-auth/providers";

export interface DingtalkProfile {
  unionid: string;
  name: string;
  dept?: string | null;
}

export function isDingtalkEnabled(): boolean {
  return process.env.DINGTALK_ENABLED === "true";
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
