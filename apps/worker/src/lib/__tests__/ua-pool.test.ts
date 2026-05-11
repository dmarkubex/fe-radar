import { describe, expect, it } from "vitest";
import { acquireUserAgent, DEFAULT_USER_AGENT } from "../ua-pool";

describe("ua pool", () => {
  it("uses FE-Radar Bot by default", () => {
    expect(acquireUserAgent()).toBe(DEFAULT_USER_AGENT);
  });

  it("can rotate real browser user agents", () => {
    expect(acquireUserAgent(true)).toContain("Mozilla/5.0");
  });
});
