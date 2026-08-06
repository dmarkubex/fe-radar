import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import type { UserRole } from "@fe-radar/shared";
import { isDingtalkEnabled } from "@/lib/auth/dingtalk-provider";
import { mergeOrCreateUser, UserDisabledError } from "@/lib/auth/merge";
import { webLogger } from "@/lib/logger";

const APP_TOKEN_URL = "https://api.dingtalk.com/v1.0/oauth2/accessToken";
const GET_USERINFO_URL = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const GET_USER_URL = "https://oapi.dingtalk.com/topapi/v2/user/get";
const FETCH_TIMEOUT_MS = 10_000;
/** Expire buffer so concurrent logins never reuse a near-expired app token. */
const TOKEN_EXPIRE_BUFFER_MS = 5 * 60 * 1000;

const codeSchema = z.object({
  code: z.string().trim().min(1)
});

export interface InAppAuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

interface AppTokenCache {
  accessToken: string;
  /** Absolute epoch ms after which the token must not be used. */
  expiresAtMs: number;
}

let appTokenCache: AppTokenCache | null = null;
/** In-flight app-token fetch shared by concurrent callers. */
let appTokenInflight: Promise<string> | null = null;

/** Test-only: clear process-local app access token cache and inflight promise. */
export function clearDingtalkAppTokenCache(): void {
  appTokenCache = null;
  appTokenInflight = null;
}

/** Test-only: inspect cache state without exposing the token value. */
export function getDingtalkAppTokenCacheMeta(): { cached: boolean; expiresAtMs: number | null } {
  if (!appTokenCache) {
    return { cached: false, expiresAtMs: null };
  }
  return { cached: true, expiresAtMs: appTokenCache.expiresAtMs };
}

async function dingtalkFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function fetchDingtalkAppAccessToken(nowMs: number): Promise<string> {
  const appKey = process.env.DINGTALK_APP_KEY;
  const appSecret = process.env.DINGTALK_APP_SECRET;
  if (!appKey || !appSecret) {
    throw new Error("DingTalk app credentials not configured");
  }

  const response = await dingtalkFetch(APP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret })
  });

  if (!response.ok) {
    throw new Error(`DingTalk accessToken failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    accessToken?: unknown;
    expireIn?: unknown;
  };

  const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
  const expireIn = typeof body.expireIn === "number" ? body.expireIn : Number(body.expireIn);
  if (!accessToken || !Number.isFinite(expireIn) || expireIn <= 0) {
    throw new Error("DingTalk accessToken response missing accessToken or expireIn");
  }

  appTokenCache = {
    accessToken,
    expiresAtMs: nowMs + expireIn * 1000
  };
  return accessToken;
}

/**
 * Obtain (and cache) the enterprise application access token.
 * Concurrent callers share one in-flight promise. Never logs appKey/appSecret/token.
 * Failures do not populate the cache.
 */
export async function getDingtalkAppAccessToken(nowMs: number = Date.now()): Promise<string> {
  if (appTokenCache && appTokenCache.expiresAtMs > nowMs + TOKEN_EXPIRE_BUFFER_MS) {
    return appTokenCache.accessToken;
  }

  if (appTokenInflight) {
    return appTokenInflight;
  }

  appTokenInflight = fetchDingtalkAppAccessToken(nowMs).finally(() => {
    appTokenInflight = null;
  });

  return appTokenInflight;
}

interface UserinfoResult {
  userid: string;
}

/**
 * Exchange a one-time free-login code for the enterprise userid.
 * Does not log the code or access token.
 */
export async function getUserIdByAuthCode(
  accessToken: string,
  code: string
): Promise<UserinfoResult> {
  const url = `${GET_USERINFO_URL}?access_token=${encodeURIComponent(accessToken)}`;
  const response = await dingtalkFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code })
  });

  if (!response.ok) {
    throw new Error(`DingTalk getuserinfo failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    errcode?: unknown;
    result?: { userid?: unknown };
  };

  const errcode = typeof body.errcode === "number" ? body.errcode : Number(body.errcode ?? 0);
  if (!Number.isFinite(errcode) || errcode !== 0) {
    throw new Error(`DingTalk getuserinfo failed: errcode=${Number.isFinite(errcode) ? errcode : "unknown"}`);
  }

  const userid = typeof body.result?.userid === "string" ? body.result.userid.trim() : "";
  if (!userid) {
    throw new Error("DingTalk getuserinfo missing userid");
  }
  return { userid };
}

interface UserDetailResult {
  unionid: string;
  name: string;
}

/**
 * Load unionid + name for an enterprise userid.
 * Does not log unionid or access token.
 */
export async function getUserDetailByUserId(
  accessToken: string,
  userid: string
): Promise<UserDetailResult> {
  const url = `${GET_USER_URL}?access_token=${encodeURIComponent(accessToken)}`;
  const response = await dingtalkFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid, language: "zh_CN" })
  });

  if (!response.ok) {
    throw new Error(`DingTalk user/get failed: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    errcode?: unknown;
    result?: { unionid?: unknown; name?: unknown };
  };

  const errcode = typeof body.errcode === "number" ? body.errcode : Number(body.errcode ?? 0);
  if (!Number.isFinite(errcode) || errcode !== 0) {
    throw new Error(`DingTalk user/get failed: errcode=${Number.isFinite(errcode) ? errcode : "unknown"}`);
  }

  const unionid = typeof body.result?.unionid === "string" ? body.result.unionid.trim() : "";
  const name = typeof body.result?.name === "string" ? body.result.name.trim() : "";
  if (!unionid || !name) {
    throw new Error("DingTalk user/get missing unionid or name");
  }
  return { unionid, name };
}

/**
 * Full in-app free-login path: code → app token → userid → profile → mergeOrCreateUser.
 * Returns the Auth.js user shape; never logs code/token/secret/unionid.
 */
export async function resolveDingtalkInAppUser(code: string): Promise<InAppAuthUser> {
  const accessToken = await getDingtalkAppAccessToken();
  const { userid } = await getUserIdByAuthCode(accessToken, code);
  const { unionid, name } = await getUserDetailByUserId(accessToken, userid);
  const merged = await mergeOrCreateUser({
    unionid,
    name,
    dept: null
  });
  return {
    id: String(merged.id),
    name: merged.name,
    email: `${merged.id}@dingtalk-inapp.fe-radar.local`,
    role: merged.role
  };
}

/**
 * Auth.js Credentials provider for DingTalk H5 free-login codes.
 * Cookie/JWT issuance stays with Auth.js — do not hand-sign cookies.
 */
export function DingtalkInAppProvider() {
  return Credentials({
    id: "dingtalk-inapp",
    name: "钉钉内免登",
    credentials: {
      code: { label: "Auth Code", type: "text" }
    },
    async authorize(rawCredentials) {
      if (!isDingtalkEnabled()) {
        return null;
      }

      const parsed = codeSchema.safeParse(rawCredentials);
      if (!parsed.success) {
        return null;
      }

      try {
        return await resolveDingtalkInAppUser(parsed.data.code);
      } catch (err) {
        if (err instanceof UserDisabledError) {
          return null;
        }
        // Structured message only — no code/token/secret/unionid.
        const message = err instanceof Error ? err.message : "DingTalk in-app login failed";
        webLogger.warn({ error: message }, "dingtalk_inapp_login_failed");
        return null;
      }
    }
  });
}
