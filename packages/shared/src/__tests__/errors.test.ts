import { describe, expect, it } from "vitest";
import { AppError, LlmError, NotImplementedError, QuotaExceededError, SourceFetchError, toAppError } from "../errors";

describe("shared errors", () => {
  it("keeps all domain errors under AppError", () => {
    expect(new SourceFetchError("FETCH_TIMEOUT", "timeout")).toBeInstanceOf(AppError);
    expect(new LlmError("LLM_JSON_INVALID", "bad json")).toBeInstanceOf(AppError);
    expect(new QuotaExceededError("QUOTA_NORMAL_EXCEEDED", "quota exceeded")).toBeInstanceOf(AppError);
    expect(new NotImplementedError("quota")).toBeInstanceOf(AppError);
  });

  it("normalizes unknown errors", () => {
    expect(toAppError(new Error("boom")).code).toBe("INTERNAL");
    expect(toAppError("boom").details).toBe("boom");
  });
});
