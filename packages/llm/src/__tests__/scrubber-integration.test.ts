import { describe, expect, it, vi } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { withScrubber } from "../middleware/scrubber";
import type { LlmClient } from "../types";

describe("LLM scrubber integration", () => {
  it("redacts PII before payload reaches inner client", async () => {
    const chatJson = vi.fn(async (request) => ({
      value: { ok: true },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      provider: "fake",
      request
    }));
    const inner = { chatJson, embedding: vi.fn() } as unknown as LlmClient;
    const client = withScrubber(inner);

    await client.chatJson<{ ok: boolean }>({
      system: "s",
      user: "手机号 13812345678",
      schemaName: "ok",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }
    });

    expect(JSON.stringify(chatJson.mock.calls)).not.toContain("13812345678");
    expect(JSON.stringify(chatJson.mock.calls)).toContain("[REDACTED:PHONE:");
  });

  it("blocks internal IP text before LLM call", async () => {
    const inner = { chatJson: vi.fn(), embedding: vi.fn() } as unknown as LlmClient;
    const client = withScrubber(inner);

    await expect(client.chatJson({
      system: "s",
      user: "内网 192.168.1.8",
      schemaName: "ok",
      schema: { type: "object" }
    })).rejects.toBeInstanceOf(LlmError);
    expect(inner.chatJson).not.toHaveBeenCalled();
  });
});
