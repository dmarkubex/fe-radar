import { describe, expect, it, vi, type Mock } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { OpenAiCompatibleClient } from "../client";
import { withScrubber } from "../middleware/scrubber";
import type { ChatStreamDelta, ChatStreamRequest, LlmClient } from "../types";

interface FakeToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface FakeChunk {
  choices?: Array<{
    delta?: { content?: string; tool_calls?: FakeToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface FakeCreateOptions {
  timeout: number;
  maxRetries: number;
  signal?: AbortSignal;
}

async function* streamOf(chunks: FakeChunk[]): AsyncIterable<FakeChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function injectFakeCreate(create: Mock): OpenAiCompatibleClient {
  const client = new OpenAiCompatibleClient({
    provider: "test",
    apiKey: "k",
    baseURL: "http://llm.test",
    model: "test-model"
  });
  (
    client as unknown as {
      client: { chat: { completions: { create: Mock } } };
    }
  ).client = { chat: { completions: { create } } };
  return client;
}

async function collect(deltas: AsyncIterable<ChatStreamDelta>): Promise<ChatStreamDelta[]> {
  const out: ChatStreamDelta[] = [];
  for await (const delta of deltas) {
    out.push(delta);
  }
  return out;
}

describe("OpenAiCompatibleClient chatStream", () => {
  it("maps content deltas to token frames and ends with usage + done", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        { choices: [{ delta: { content: "你" } }] },
        { choices: [{ delta: { content: "好" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }
      ])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(client.chatStream({ messages: [{ role: "user", content: "hi" }] }));

    expect(deltas).toEqual([
      { type: "token", data: "你" },
      { type: "token", data: "好" },
      { type: "usage", data: { inputTokens: 3, outputTokens: 2, totalTokens: 5, costCny: 0 } },
      { type: "done" }
    ]);
  });

  it("emits done even when the stream carries no usage", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(client.chatStream({ messages: [{ role: "user", content: "hi" }] }));

    expect(deltas).toEqual([
      { type: "token", data: "ok" },
      { type: "done" }
    ]);
  });

  it("assembles tool_call fragments by index into complete frames on finish_reason=tool_calls", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", function: { name: "get_quotes", arguments: '{"co' } },
                  { index: 1, id: "call_2", function: { name: "get_item", arguments: "{" } }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'de":"CU"}' } },
                  { index: 1, function: { arguments: '"id":7}' } }
                ]
              }
            }
          ]
        },
        { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
      ])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(client.chatStream({ messages: [{ role: "user", content: "查" }] }));

    expect(deltas).toEqual([
      {
        type: "tool_call",
        data: { id: "call_1", name: "get_quotes", arguments: '{"code":"CU"}' }
      },
      {
        type: "tool_call",
        data: { id: "call_2", name: "get_item", arguments: '{"id":7}' }
      },
      { type: "usage", data: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costCny: 0 } },
      { type: "done" }
    ]);
  });

  it("flushes pending tool_call frames even when the stream ends without finish_reason=tool_calls", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_quotes", arguments: "{}" } }] } }
          ]
        }
      ])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(client.chatStream({ messages: [{ role: "user", content: "查" }] }));

    expect(deltas).toEqual([
      { type: "tool_call", data: { id: "call_1", name: "get_quotes", arguments: "{}" } },
      { type: "done" }
    ]);
  });

  it("creates with stream:true, tools, 60s timeout, 0 retries and forwarded signal; maps tool roles", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }])
    );
    const client = injectFakeCreate(create);
    const controller = new AbortController();
    const tools = [
      {
        type: "function" as const,
        function: { name: "get_quotes", description: "查行情", parameters: { type: "object" } }
      }
    ];

    await collect(
      client.chatStream({
        messages: [
          { role: "user", content: "查铜价" },
          { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "get_quotes", arguments: "{}" }] },
          { role: "tool", content: "CU 70000", tool_call_id: "call_1" }
        ],
        tools,
        temperature: 0.7,
        signal: controller.signal
      })
    );

    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0] as unknown as [Record<string, unknown>, FakeCreateOptions];
    const [params, options] = createCall;
    expect(params).toMatchObject({
      model: "test-model",
      temperature: 0.7,
      stream: true,
      stream_options: { include_usage: true },
      tools
    });
    expect(options).toEqual({ timeout: 60_000, maxRetries: 0, signal: controller.signal });
    expect(params.messages).toEqual([
      { role: "user", content: "查铜价" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "get_quotes", arguments: "{}" } }
        ]
      },
      { role: "tool", content: "CU 70000", tool_call_id: "call_1" }
    ]);
  });
});

describe("ScrubbedLlmClient chatStream", () => {
  it("scrubs every message content (incl. tool role) and forwards signal untouched", async () => {
    const chatStream = vi.fn(async function* (_request: ChatStreamRequest): AsyncIterable<ChatStreamDelta> {
      yield { type: "done" };
    });
    const inner = { chatJson: vi.fn(), embedding: vi.fn(), chatStream } as unknown as LlmClient;
    const client = withScrubber(inner);
    const signal = new AbortController().signal;

    await collect(
      client.chatStream({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "手机号 13812345678" },
          { role: "assistant", content: "查一下" },
          { role: "tool", content: "电话 13912345678 结果", tool_call_id: "t1" }
        ],
        signal
      })
    );

    expect(chatStream).toHaveBeenCalledTimes(1);
    const forwarded = chatStream.mock.calls[0]?.[0];
    expect(JSON.stringify(forwarded)).not.toContain("13812345678");
    expect(JSON.stringify(forwarded)).not.toContain("13912345678");
    expect(JSON.stringify(forwarded)).toContain("[REDACTED:PHONE:");
    expect(forwarded?.messages[0]).toEqual({ role: "system", content: "sys" });
    expect(forwarded?.messages[2]).toEqual({ role: "assistant", content: "查一下" });
    expect(forwarded?.messages[3]).toMatchObject({ role: "tool", tool_call_id: "t1" });
    expect(JSON.stringify(forwarded?.messages[3])).toContain("[REDACTED:PHONE:");
    expect(forwarded?.signal).toBe(signal);
  });

  it("throws two-arg LlmError and never calls inner when any message (tool role) blocks", async () => {
    const chatStream = vi.fn();
    const inner = { chatJson: vi.fn(), embedding: vi.fn(), chatStream } as unknown as LlmClient;
    const client = withScrubber(inner);

    await expect(
      collect(
        client.chatStream({
          messages: [
            { role: "user", content: "q" },
            { role: "tool", content: "内网 192.168.1.8 上的数据", tool_call_id: "t1" }
          ]
        })
      )
    ).rejects.toMatchObject({ code: "SCRUBBER_BLOCKED", message: "scrubber blocked" });

    expect(chatStream).not.toHaveBeenCalled();
  });

  it("rejects with LlmError instance (class check)", async () => {
    const inner = { chatJson: vi.fn(), embedding: vi.fn(), chatStream: vi.fn() } as unknown as LlmClient;
    const client = withScrubber(inner);

    await expect(
      collect(
        client.chatStream({
          messages: [{ role: "user", content: "内网 10.0.0.5 的服务器" }]
        })
      )
    ).rejects.toBeInstanceOf(LlmError);
  });
});
