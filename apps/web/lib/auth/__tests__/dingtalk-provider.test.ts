import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDingtalkCallbackUrl } from "../dingtalk-callback";
import { DingtalkProvider, isDingtalkEnabled, isLocalLoginAllowed } from "../dingtalk-provider";

vi.mock("next-auth", () => ({ customFetch: Symbol.for("next-auth.customFetch") }));

// Antigravity #1 — local login is emergency-only when DingTalk SSO is enabled.
describe("isLocalLoginAllowed (emergency break-glass policy)", () => {
  const orig = { ...process.env };

  beforeEach(() => {
    delete process.env.DINGTALK_ENABLED;
    delete process.env.EMERGENCY_LOCAL_LOGIN;
  });
  afterEach(() => {
    process.env = { ...orig };
  });

  it("allows local login when DingTalk is disabled (M0–M3: only method)", () => {
    expect(isDingtalkEnabled()).toBe(false);
    expect(isLocalLoginAllowed()).toBe(true);
  });

  it("rejects local login when DingTalk is enabled and emergency flag is unset", () => {
    process.env.DINGTALK_ENABLED = "true";
    expect(isLocalLoginAllowed()).toBe(false);
  });

  it("allows local login when DingTalk is enabled but emergency flag is set", () => {
    process.env.DINGTALK_ENABLED = "true";
    process.env.EMERGENCY_LOCAL_LOGIN = "true";
    expect(isLocalLoginAllowed()).toBe(true);
  });

  it("treats any non-'true' emergency value as locked", () => {
    process.env.DINGTALK_ENABLED = "true";
    process.env.EMERGENCY_LOCAL_LOGIN = "1";
    expect(isLocalLoginAllowed()).toBe(false);
  });
});

describe("normalizeDingtalkCallbackUrl", () => {
  it("maps DingTalk authCode callbacks to the OAuth code parameter Auth.js expects", () => {
    const url = normalizeDingtalkCallbackUrl("https://fe.example/api/auth/callback/dingtalk?authCode=abc&state=s1");

    expect(url).toBe("https://fe.example/api/auth/callback/dingtalk?authCode=abc&state=s1&code=abc");
  });

  it("does not overwrite an existing code parameter", () => {
    const url = normalizeDingtalkCallbackUrl("https://fe.example/api/auth/callback/dingtalk?authCode=abc&code=keep&state=s1");

    expect(url).toBe("https://fe.example/api/auth/callback/dingtalk?authCode=abc&code=keep&state=s1");
  });
});

describe("DingtalkProvider userinfo", () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("maps the official nick/unionId response shape into the local profile", async () => {
    globalThis.fetch = async () =>
      Response.json({
        nick: "张三",
        unionId: "union-1",
        openId: "open-1"
      });

    const provider = DingtalkProvider();
    const profile = await provider.userinfo?.request?.({ tokens: { access_token: "token-1" } });

    expect(profile).toEqual({ unionid: "union-1", name: "张三", dept: null });
  });

  it("preserves DingTalk HTTP status and error code when userinfo fails", async () => {
    globalThis.fetch = async () =>
      Response.json(
        { code: "ForbiddenAccess.NotInContactScope", message: "not in scope" },
        { status: 403 }
      );

    const provider = DingtalkProvider();

    await expect(provider.userinfo?.request?.({ tokens: { access_token: "token-1" } })).rejects.toThrow(
      "DingTalk userinfo failed: HTTP 403 (ForbiddenAccess.NotInContactScope not in scope)"
    );
  });
});
