import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleClient, stripMarkdownJsonFence } from "../client";

function createMockClient(jsonResponseFormat?: "auto" | "json_schema" | "json_object") {
  const create = vi.fn();
  const client = new OpenAiCompatibleClient({
    provider: "test",
    apiKey: "test-key",
    baseURL: "https://example.com/v1",
    model: "test-model",
    jsonResponseFormat,
  });
  (client as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
    chat: { completions: { create } },
  };
  return { client, create };
}

const request = {
  schemaName: "test_schema",
  schema: { type: "object", properties: { ok: { type: "boolean" } } },
  system: "You are a test assistant.",
  user: "Return ok true.",
};

describe("OpenAiCompatibleClient temperature", () => {
  function mk(defaultTemperature?: number) {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const client = new OpenAiCompatibleClient({
      provider: "test",
      apiKey: "k",
      baseURL: "https://example.com/v1",
      model: "m",
      jsonResponseFormat: "json_object",
      defaultTemperature,
    });
    (client as unknown as { client: { chat: { completions: { create: typeof create } } } }).client = {
      chat: { completions: { create } },
    };
    return { client, create };
  }

  it("defaults temperature to 0.2 when no override", async () => {
    const { client, create } = mk();
    await client.chatJson<{ ok: boolean }>(request);
    expect(create.mock.calls[0]?.[0].temperature).toBe(0.2);
  });

  it("uses per-client defaultTemperature when set (kimi-k2.6 requires 1)", async () => {
    const { client, create } = mk(1);
    await client.chatJson<{ ok: boolean }>(request);
    expect(create.mock.calls[0]?.[0].temperature).toBe(1);
  });
});

describe("stripMarkdownJsonFence", () => {
  it("strips closed json fences", () => {
    expect(stripMarkdownJsonFence('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("strips fences without a language tag", () => {
    expect(stripMarkdownJsonFence('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it("leaves plain JSON unchanged", () => {
    expect(stripMarkdownJsonFence('{"ok":true}')).toBe('{"ok":true}');
  });
});

describe("OpenAiCompatibleClient chatJson", () => {
  it("uses json_object directly when configured", async () => {
    const { client, create } = createMockClient("json_object");
    create.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await client.chatJson<{ ok: boolean }>(request);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].response_format).toEqual({ type: "json_object" });
    expect(create.mock.calls[0]?.[0].messages[0]?.content).toContain("JSON Schema");
  });

  it("falls back to json_object once when auto mode hits unsupported json_schema", async () => {
    const { client, create } = createMockClient("auto");
    create
      .mockRejectedValueOnce(new Error("This response_format type is unavailable now"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

    await client.chatJson<{ ok: boolean }>(request);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0].response_format?.type).toBe("json_schema");
    expect(create.mock.calls[1]?.[0].response_format).toEqual({ type: "json_object" });
  });

  it("parses JSON wrapped in markdown fences", async () => {
    const { client, create } = createMockClient("json_object");
    create.mockResolvedValue({
      choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await expect(client.chatJson<{ ok: boolean }>(request)).resolves.toMatchObject({
      value: { ok: true },
    });
  });

  it("skips json_schema probe after auto mode learns unsupported capability", async () => {
    const { client, create } = createMockClient("auto");
    create.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    create
      .mockRejectedValueOnce(new Error("response_format json_schema unsupported"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    await client.chatJson<{ ok: boolean }>(request);

    create.mockClear();
    create.mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    await client.chatJson<{ ok: boolean }>(request);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].response_format).toEqual({ type: "json_object" });
  });
});
