import { describe, expect, it } from "vitest";
import { REDACT_PATHS, createLogger } from "../logger";

describe("shared logger", () => {
  it("uses required redaction paths", () => {
    expect(REDACT_PATHS).toContain("passwordHash");
    expect(REDACT_PATHS).toContain("headers.cookie");
    expect(REDACT_PATHS).toContain("phone");
  });

  it("creates a service-bound logger", () => {
    expect(createLogger({ service: "test" }).bindings().service).toBe("test");
  });
});
