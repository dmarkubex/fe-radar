import { describe, expect, it } from "vitest";
import { scrubText } from "../index";

describe("scrubber", () => {
  it("redacts PII with irreversible placeholders", () => {
    const result = scrubText("联系人 13812345678 邮箱 a@example.com", { itemId: 1 });
    expect(result.cleaned).not.toContain("13812345678");
    expect(result.cleaned).toContain("[REDACTED:PHONE:");
    expect(result.audit.itemId).toBe(1);
  });

  it("blocks internal IPs fail-safe", () => {
    const result = scrubText("内部地址 10.1.2.3");
    expect(result.level).toBe("block");
  });

  it("redacts project code dictionary entries", () => {
    const result = scrubText("项目代号 X-SECRET", { projectCodes: ["X-SECRET"] });
    expect(result.cleaned).toContain("[REDACTED:PROJECT_CODE:");
  });

  // Regression: short code before long overlapping code used to fragment the
  // longer match and leave literal residue (e.g. "-2026") for the public LLM.
  it("redacts longer project codes before shorter substring codes (ZX / ZX-2026 order)", () => {
    const projectCodes = ["ZX", "ZX-2026"];
    const result = scrubText("项目 ZX-2026 进展顺利", { projectCodes });
    expect(result.cleaned).not.toContain("ZX");
    expect(result.cleaned).not.toContain("2026");
    expect(result.cleaned).not.toContain("-2026");
    expect(result.cleaned).toContain("[REDACTED:PROJECT_CODE:");
    // Caller array must not be mutated (sorted copy only).
    expect(projectCodes).toEqual(["ZX", "ZX-2026"]);
  });

  it("redacts nested substring project codes regardless of input order", () => {
    // ≥3 codes with mutual substring relations, deliberately shuffled.
    // Avoid single-letter codes: they collide with letters inside REDACTED placeholders.
    const projectCodes = ["FOO-BAR", "FOO", "FOO-BAR-BAZ"];
    const result = scrubText("涉及 FOO-BAR-BAZ 以及 FOO-BAR 还有 FOO 结束", { projectCodes });
    // Fully redacted: no original code residue of length ≥2 continuous fragments.
    expect(result.cleaned).not.toContain("FOO-BAR-BAZ");
    expect(result.cleaned).not.toContain("FOO-BAR");
    expect(result.cleaned).not.toContain("FOO");
    expect(result.cleaned).not.toContain("BAR");
    expect(result.cleaned).not.toContain("BAZ");
    expect(result.cleaned).toContain("[REDACTED:PROJECT_CODE:");
    // Caller array must not be mutated.
    expect(projectCodes).toEqual(["FOO-BAR", "FOO", "FOO-BAR-BAZ"]);
  });

  it("keeps safe text unchanged", () => {
    const result = scrubText("国家能源局发布政策");
    expect(result.level).toBe("safe");
    expect(result.cleaned).toBe("国家能源局发布政策");
  });
});
