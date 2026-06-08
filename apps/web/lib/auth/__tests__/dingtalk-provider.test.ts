import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDingtalkEnabled, isLocalLoginAllowed } from "../dingtalk-provider";

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
