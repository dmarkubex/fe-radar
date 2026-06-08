import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS, createLogger } from "../logger";

describe("shared logger", () => {
  it("uses required redaction paths", () => {
    expect(REDACT_PATHS).toContain("passwordHash");
    expect(REDACT_PATHS).toContain("headers.cookie");
    expect(REDACT_PATHS).toContain("phone");
  });

  it("includes v1.1 dingtalk credential fields (CLAUDE.md 陷阱 #11)", () => {
    for (const p of ["webhookUrl", "signSecret", "webhook_url", "sign_secret"]) {
      expect(REDACT_PATHS).toContain(p);
    }
  });

  it("creates a service-bound logger", () => {
    expect(createLogger({ service: "test" }).bindings().service).toBe("test");
  });

  // Real serialization test (Antigravity #2): the actual pino output must redact
  // credentials, not just expose a constant array.
  function captureLine(
    logFn: (log: ReturnType<typeof createLogger>) => void,
    redactPaths?: string[]
  ): Record<string, unknown> {
    let raw = "";
    const stream = new Writable({
      write(chunk, _enc, cb) {
        raw += chunk.toString();
        cb();
      }
    });
    const log = createLogger({ service: "redact-test", destination: stream, redactPaths });
    logFn(log);
    return JSON.parse(raw.trim().split("\n").pop()!) as Record<string, unknown>;
  }

  it("redacts password/token in real serialized output", () => {
    const line = captureLine((log) => log.info({ password: "p@ss", token: "tk" }, "msg"));
    expect(line.password).toBe("[REDACTED]");
    expect(line.token).toBe("[REDACTED]");
  });

  it("redacts dingtalk webhook/sign credentials in real serialized output", () => {
    const line = captureLine(
      (log) => log.info({ webhookUrl: "https://oapi/robot/send?access_token=SECRET", signSecret: "SEC123" }, "push"),
      ["webhookUrl", "signSecret"]
    );
    expect(line.webhookUrl).toBe("[REDACTED]");
    expect(line.signSecret).toBe("[REDACTED]");
    expect(JSON.stringify(line)).not.toContain("SECRET");
    expect(JSON.stringify(line)).not.toContain("SEC123");
  });
});
