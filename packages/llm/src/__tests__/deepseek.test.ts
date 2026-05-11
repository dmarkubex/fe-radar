import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { requireEnv } from "../client";

describe("deepseek client config", () => {
  it("requires DEEPSEEK_API_KEY", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => requireEnv("DEEPSEEK_API_KEY")).toThrow(LlmError);
    vi.unstubAllEnvs();
  });
});
