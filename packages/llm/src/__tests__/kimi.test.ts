import { describe, expect, it } from "vitest";
import { KIMI_CONTEXT_LIMIT_TOKENS, assertKimiContext, estimateKimiTokens } from "../clients/kimi";

describe("kimi client", () => {
  it("accepts large but bounded context", () => {
    expect(() => assertKimiContext("a".repeat(KIMI_CONTEXT_LIMIT_TOKENS))).not.toThrow();
  });

  it("estimates tokens conservatively for long reports", () => {
    expect(estimateKimiTokens("abcd")).toBe(2);
  });
});
