import { describe, expect, it } from "vitest";
import { KIMI_CONTEXT_LIMIT_TOKENS, assertKimiContext, createQwenClient } from "../index";

describe("LLM clients", () => {
  it("creates qwen client with local defaults", () => {
    expect(createQwenClient()).toBeTruthy();
  });

  it("enforces kimi context limit", () => {
    expect(() => assertKimiContext("a".repeat(KIMI_CONTEXT_LIMIT_TOKENS * 2 + 2))).toThrow();
  });
});
