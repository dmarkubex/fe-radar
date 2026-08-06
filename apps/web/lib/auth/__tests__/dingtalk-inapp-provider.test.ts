import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  default: {},
  customFetch: Symbol.for("next-auth.customFetch")
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (config: unknown) => config
}));

const mergeOrCreateUser = vi.hoisted(() => vi.fn());
const UserDisabledError = vi.hoisted(
  () =>
    class UserDisabledError extends Error {
      constructor() {
        super("User account is disabled");
        this.name = "UserDisabledError";
      }
    }
);

vi.mock("../merge", () => ({
  mergeOrCreateUser,
  UserDisabledError
}));

const {
  clearDingtalkAppTokenCache,
  getDingtalkAppAccessToken,
  getDingtalkAppTokenCacheMeta,
  getUserDetailByUserId,
  getUserIdByAuthCode,
  resolveDingtalkInAppUser,
  DingtalkInAppProvider
} = await import("../dingtalk-inapp-provider");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("dingtalk-inapp-provider", () => {
  const origFetch = globalThis.fetch;
  const origEnv = { ...process.env };

  beforeEach(() => {
    clearDingtalkAppTokenCache();
    mergeOrCreateUser.mockReset();
    process.env.DINGTALK_APP_KEY = "test-app-key";
    process.env.DINGTALK_APP_SECRET = "test-app-secret";
    process.env.DINGTALK_ENABLED = "true";
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    process.env = { ...origEnv };
    clearDingtalkAppTokenCache();
  });

  describe("getDingtalkAppAccessToken", () => {
    it("POSTs appKey/appSecret and caches token with 5-minute buffer", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ accessToken: "app-token-1", expireIn: 7200 })
      );
      globalThis.fetch = fetchMock as typeof fetch;

      const now = 1_700_000_000_000;
      const token1 = await getDingtalkAppAccessToken(now);
      const token2 = await getDingtalkAppAccessToken(now + 60_000);

      expect(token1).toBe("app-token-1");
      expect(token2).toBe("app-token-1");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.dingtalk.com/v1.0/oauth2/accessToken");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        appKey: "test-app-key",
        appSecret: "test-app-secret"
      });

      const meta = getDingtalkAppTokenCacheMeta();
      expect(meta.cached).toBe(true);
      expect(meta.expiresAtMs).toBe(now + 7200 * 1000);
    });

    it("shares one in-flight promise across concurrent callers", async () => {
      let resolveFetch!: (value: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
      const fetchMock = vi.fn().mockReturnValue(fetchPromise);
      globalThis.fetch = fetchMock as typeof fetch;

      const p1 = getDingtalkAppAccessToken(1_700_000_000_000);
      const p2 = getDingtalkAppAccessToken(1_700_000_000_000);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveFetch(jsonResponse({ accessToken: "shared-token", expireIn: 3600 }));
      await expect(Promise.all([p1, p2])).resolves.toEqual(["shared-token", "shared-token"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not cache failed token fetches", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ message: "fail" }, 500))
        .mockResolvedValueOnce(jsonResponse({ accessToken: "ok-token", expireIn: 3600 }));
      globalThis.fetch = fetchMock as typeof fetch;

      await expect(getDingtalkAppAccessToken(1_700_000_000_000)).rejects.toThrow(
        "DingTalk accessToken failed: HTTP 500"
      );
      expect(getDingtalkAppTokenCacheMeta().cached).toBe(false);

      await expect(getDingtalkAppAccessToken(1_700_000_000_000)).resolves.toBe("ok-token");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects missing accessToken/expireIn without caching", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({})) as typeof fetch;
      await expect(getDingtalkAppAccessToken()).rejects.toThrow(
        "DingTalk accessToken response missing accessToken or expireIn"
      );
      expect(getDingtalkAppTokenCacheMeta().cached).toBe(false);
    });

    it("refetches when token is inside the 5-minute expire buffer", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ accessToken: "old", expireIn: 200 }))
        .mockResolvedValueOnce(jsonResponse({ accessToken: "new", expireIn: 7200 }));
      globalThis.fetch = fetchMock as typeof fetch;

      const now = 1_700_000_000_000;
      await expect(getDingtalkAppAccessToken(now)).resolves.toBe("old");
      // expireIn=200s → expiresAt = now+200000; buffer needs > now+300000 → miss cache
      await expect(getDingtalkAppAccessToken(now + 1)).resolves.toBe("new");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("getUserIdByAuthCode", () => {
    it("returns userid on errcode 0", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 0, result: { userid: "user-1" } })
      ) as typeof fetch;

      await expect(getUserIdByAuthCode("tok", "auth-code")).resolves.toEqual({ userid: "user-1" });
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit
      ];
      expect(url).toContain("topapi/v2/user/getuserinfo");
      expect(url).toContain("access_token=tok");
      expect(JSON.parse(String(init.body))).toEqual({ code: "auth-code" });
    });

    it("rejects non-zero errcode and missing userid", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 40014, errmsg: "invalid" })
      ) as typeof fetch;
      await expect(getUserIdByAuthCode("tok", "c")).rejects.toThrow(
        "DingTalk getuserinfo failed: errcode=40014"
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 0, result: {} })
      ) as typeof fetch;
      await expect(getUserIdByAuthCode("tok", "c")).rejects.toThrow(
        "DingTalk getuserinfo missing userid"
      );
    });

    it("rejects non-2xx HTTP", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({}, 502)) as typeof fetch;
      await expect(getUserIdByAuthCode("tok", "c")).rejects.toThrow(
        "DingTalk getuserinfo failed: HTTP 502"
      );
    });
  });

  describe("getUserDetailByUserId", () => {
    it("returns unionid and name", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 0, result: { unionid: "u-1", name: "张三" } })
      ) as typeof fetch;

      await expect(getUserDetailByUserId("tok", "user-1")).resolves.toEqual({
        unionid: "u-1",
        name: "张三"
      });
      const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit
      ];
      expect(url).toContain("topapi/v2/user/get");
      expect(JSON.parse(String(init.body))).toEqual({ userid: "user-1", language: "zh_CN" });
    });

    it("rejects missing fields and errcode", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 0, result: { unionid: "u-1", name: "" } })
      ) as typeof fetch;
      await expect(getUserDetailByUserId("tok", "u")).rejects.toThrow(
        "DingTalk user/get missing unionid or name"
      );

      globalThis.fetch = vi.fn().mockResolvedValue(
        jsonResponse({ errcode: 88 })
      ) as typeof fetch;
      await expect(getUserDetailByUserId("tok", "u")).rejects.toThrow(
        "DingTalk user/get failed: errcode=88"
      );
    });
  });

  describe("resolveDingtalkInAppUser", () => {
    it("maps merge result to Auth.js user shape", async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth2/accessToken")) {
          return jsonResponse({ accessToken: "app-tok", expireIn: 7200 });
        }
        if (url.includes("getuserinfo")) {
          return jsonResponse({ errcode: 0, result: { userid: "uid-9" } });
        }
        if (url.includes("user/get")) {
          return jsonResponse({ errcode: 0, result: { unionid: "union-9", name: "李四" } });
        }
        return jsonResponse({}, 404);
      }) as typeof fetch;

      mergeOrCreateUser.mockResolvedValue({
        id: 42,
        name: "李四",
        role: "viewer",
        dingtalkId: "union-9"
      });

      await expect(resolveDingtalkInAppUser("one-time-code")).resolves.toEqual({
        id: "42",
        name: "李四",
        email: "42@dingtalk-inapp.fe-radar.local",
        role: "viewer"
      });

      expect(mergeOrCreateUser).toHaveBeenCalledWith({
        unionid: "union-9",
        name: "李四",
        dept: null
      });
    });

    it("propagates UserDisabledError from merge", async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth2/accessToken")) {
          return jsonResponse({ accessToken: "app-tok", expireIn: 7200 });
        }
        if (url.includes("getuserinfo")) {
          return jsonResponse({ errcode: 0, result: { userid: "uid-9" } });
        }
        return jsonResponse({ errcode: 0, result: { unionid: "union-9", name: "李四" } });
      }) as typeof fetch;

      mergeOrCreateUser.mockRejectedValue(new UserDisabledError());
      await expect(resolveDingtalkInAppUser("code")).rejects.toBeInstanceOf(UserDisabledError);
    });
  });

  describe("DingtalkInAppProvider authorize", () => {
    it("registers id dingtalk-inapp", () => {
      const provider = DingtalkInAppProvider() as { id: string };
      expect(provider.id).toBe("dingtalk-inapp");
    });

    it("returns null for disabled users without throwing", async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/oauth2/accessToken")) {
          return jsonResponse({ accessToken: "app-tok", expireIn: 7200 });
        }
        if (url.includes("getuserinfo")) {
          return jsonResponse({ errcode: 0, result: { userid: "uid-9" } });
        }
        return jsonResponse({ errcode: 0, result: { unionid: "union-9", name: "李四" } });
      }) as typeof fetch;
      mergeOrCreateUser.mockRejectedValue(new UserDisabledError());

      const provider = DingtalkInAppProvider() as unknown as {
        authorize: (creds: Record<string, string>, request: Request) => Promise<unknown>;
      };
      await expect(provider.authorize({ code: "x" }, new Request("http://local"))).resolves.toBeNull();
    });

    it("returns null when DingTalk is disabled", async () => {
      process.env.DINGTALK_ENABLED = "false";
      const provider = DingtalkInAppProvider() as unknown as {
        authorize: (creds: Record<string, string>, request: Request) => Promise<unknown>;
      };
      await expect(provider.authorize({ code: "x" }, new Request("http://local"))).resolves.toBeNull();
      expect(mergeOrCreateUser).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only code without calling DingTalk", async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as typeof fetch;
      const provider = DingtalkInAppProvider() as unknown as {
        authorize: (creds: Record<string, string>, request: Request) => Promise<unknown>;
      };

      await expect(provider.authorize({ code: "   " }, new Request("http://local"))).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
