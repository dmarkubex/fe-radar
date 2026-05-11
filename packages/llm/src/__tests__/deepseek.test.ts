import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { requireEnv } from "../client";
import { DEEPSEEK_SCORING_SCHEMA_NAME } from "../clients/deepseek";

describe("deepseek client config", () => {
  it("requires DEEPSEEK_API_KEY", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => requireEnv("DEEPSEEK_API_KEY")).toThrow(LlmError);
    vi.unstubAllEnvs();
  });

  it("documents the scoring schema name", () => {
    expect(DEEPSEEK_SCORING_SCHEMA_NAME).toBe("fe_radar_scoring");
  });
});
