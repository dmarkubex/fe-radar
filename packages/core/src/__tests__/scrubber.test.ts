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

  it("keeps safe text unchanged", () => {
    const result = scrubText("国家能源局发布政策");
    expect(result.level).toBe("safe");
    expect(result.cleaned).toBe("国家能源局发布政策");
  });
});
