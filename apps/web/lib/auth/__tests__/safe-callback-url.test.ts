import { describe, expect, it } from "vitest";
import {
  buildSafeCallbackUrl,
  isDingTalkUserAgent,
  normalizeSafeCallbackUrl
} from "../safe-callback-url";

describe("normalizeSafeCallbackUrl", () => {
  it("keeps same-site relative paths with query", () => {
    expect(normalizeSafeCallbackUrl("/daily?date=2026-08-06")).toBe("/daily?date=2026-08-06");
    expect(normalizeSafeCallbackUrl("/briefing/123")).toBe("/briefing/123");
    expect(normalizeSafeCallbackUrl("/")).toBe("/");
  });

  it("rejects absolute external URLs", () => {
    expect(normalizeSafeCallbackUrl("https://evil.example")).toBe("/");
    expect(normalizeSafeCallbackUrl("http://evil.example/path")).toBe("/");
  });

  it("rejects protocol-relative URLs", () => {
    expect(normalizeSafeCallbackUrl("//evil.example")).toBe("/");
    expect(normalizeSafeCallbackUrl("//evil.example/phish")).toBe("/");
  });

  it("rejects scheme-based and control-character payloads", () => {
    expect(normalizeSafeCallbackUrl("javascript:alert(1)")).toBe("/");
    expect(normalizeSafeCallbackUrl("data:text/html,hi")).toBe("/");
    expect(normalizeSafeCallbackUrl("/ok\u0000evil")).toBe("/");
    expect(normalizeSafeCallbackUrl("/path\\evil")).toBe("/");
  });

  it("falls back for null, empty, or non-path values", () => {
    expect(normalizeSafeCallbackUrl(null)).toBe("/");
    expect(normalizeSafeCallbackUrl(undefined)).toBe("/");
    expect(normalizeSafeCallbackUrl("")).toBe("/");
    expect(normalizeSafeCallbackUrl("   ")).toBe("/");
    expect(normalizeSafeCallbackUrl("relative-no-slash")).toBe("/");
  });
});

describe("buildSafeCallbackUrl", () => {
  it("joins pathname and search and preserves query", () => {
    expect(buildSafeCallbackUrl("/daily", "?date=2026-08-06")).toBe("/daily?date=2026-08-06");
    expect(buildSafeCallbackUrl("/daily", "date=2026-08-06")).toBe("/daily?date=2026-08-06");
    expect(buildSafeCallbackUrl("/briefing/1", "")).toBe("/briefing/1");
  });
});

describe("isDingTalkUserAgent", () => {
  it("detects DingTalk clients", () => {
    expect(isDingTalkUserAgent("Mozilla/5.0 (iPhone) DingTalk/7.0.0")).toBe(true);
    expect(
      isDingTalkUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 DingTalk(6.5.0)"
      )
    ).toBe(true);
  });

  it("rejects external browsers", () => {
    expect(isDingTalkUserAgent("Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36")).toBe(false);
    expect(isDingTalkUserAgent(null)).toBe(false);
    expect(isDingTalkUserAgent("")).toBe(false);
  });
});
