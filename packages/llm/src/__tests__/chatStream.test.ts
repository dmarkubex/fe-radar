import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi, type Mock } from "vitest";
import { LlmError } from "@fe-radar/shared";
import { LLM_HARD_TIMEOUT_CODE, OpenAiCompatibleClient } from "../client";
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

async function collect(
  deltas: AsyncIterable<ChatStreamDelta>
): Promise<ChatStreamDelta[]> {
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

    const deltas = await collect(
      client.chatStream({ messages: [{ role: "user", content: "hi" }] })
    );

    expect(deltas).toEqual([
      { type: "token", data: "你" },
      { type: "token", data: "好" },
      {
        type: "usage",
        data: { inputTokens: 3, outputTokens: 2, totalTokens: 5, costCny: 0 }
      },
      { type: "done" }
    ]);
  });

  it("emits done even when the stream carries no usage", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
      ])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(
      client.chatStream({ messages: [{ role: "user", content: "hi" }] })
    );

    expect(deltas).toEqual([{ type: "token", data: "ok" }, { type: "done" }]);
  });

  it("assembles tool_call fragments by index into complete frames on finish_reason=tool_calls", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "get_quotes", arguments: '{"co' }
                  },
                  {
                    index: 1,
                    id: "call_2",
                    function: { name: "get_item", arguments: "{" }
                  }
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

    const deltas = await collect(
      client.chatStream({ messages: [{ role: "user", content: "查" }] })
    );

    expect(deltas).toEqual([
      {
        type: "tool_call",
        data: { id: "call_1", name: "get_quotes", arguments: '{"code":"CU"}' }
      },
      {
        type: "tool_call",
        data: { id: "call_2", name: "get_item", arguments: '{"id":7}' }
      },
      {
        type: "usage",
        data: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costCny: 0 }
      },
      { type: "done" }
    ]);
  });

  it("flushes pending tool_call frames even when the stream ends without finish_reason=tool_calls", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "get_quotes", arguments: "{}" }
                  }
                ]
              }
            }
          ]
        }
      ])
    );
    const client = injectFakeCreate(create);

    const deltas = await collect(
      client.chatStream({ messages: [{ role: "user", content: "查" }] })
    );

    expect(deltas).toEqual([
      {
        type: "tool_call",
        data: { id: "call_1", name: "get_quotes", arguments: "{}" }
      },
      { type: "done" }
    ]);
  });

  it("creates with stream:true, tools, 60s timeout, 0 retries and forwarded signal; maps tool roles", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
      ])
    );
    const client = injectFakeCreate(create);
    const controller = new AbortController();
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "get_quotes",
          description: "查行情",
          parameters: { type: "object" }
        }
      }
    ];

    await collect(
      client.chatStream({
        messages: [
          { role: "user", content: "查铜价" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", name: "get_quotes", arguments: "{}" }]
          },
          { role: "tool", content: "CU 70000", tool_call_id: "call_1" }
        ],
        tools,
        temperature: 0.7,
        signal: controller.signal
      })
    );

    expect(create).toHaveBeenCalledTimes(1);
    const createCall = create.mock.calls[0] as unknown as [
      Record<string, unknown>,
      FakeCreateOptions
    ];
    const [params, options] = createCall;
    expect(params).toMatchObject({
      model: "test-model",
      temperature: 0.7,
      thinking: { type: "disabled" },
      stream: true,
      stream_options: { include_usage: true },
      tools
    });
    expect(options).toEqual({
      timeout: 60_000,
      maxRetries: 0,
      signal: controller.signal
    });
    expect(params.messages).toEqual([
      { role: "user", content: "查铜价" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_quotes", arguments: "{}" }
          }
        ]
      },
      { role: "tool", content: "CU 70000", tool_call_id: "call_1" }
    ]);
  });

  it("does not add thinking to chatJson requests", async () => {
    const create: Mock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    });
    const client = injectFakeCreate(create);

    await client.chatJson<{ ok: boolean }>({
      system: "system",
      user: "user",
      schemaName: "result",
      schema: { type: "object" }
    });

    const params = (
      create.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect("thinking" in params).toBe(false);
  });

  it("forwards request.tool_choice to create() when provided (copilot compression)", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
      ])
    );
    const client = injectFakeCreate(create);
    await collect(
      client.chatStream({
        messages: [{ role: "user", content: "compress this" }],
        tools: [
          {
            type: "function" as const,
            function: {
              name: "generate_structured_output",
              description: "comp",
              parameters: { type: "object" }
            }
          }
        ],
        tool_choice: {
          type: "function",
          function: { name: "generate_structured_output" }
        },
        temperature: 0.2
      })
    );
    const params = (
      create.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect(params.tool_choice).toEqual({
      type: "function",
      function: { name: "generate_structured_output" }
    });
    expect(params.tools).toEqual([
      {
        type: "function",
        function: {
          name: "generate_structured_output",
          description: "comp",
          parameters: { type: "object" }
        }
      }
    ]);
  });

  it("omits tool_choice when caller does not set it (default behavior preserved)", async () => {
    const create: Mock = vi.fn(() =>
      streamOf([
        { choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }
      ])
    );
    const client = injectFakeCreate(create);
    await collect(
      client.chatStream({
        messages: [{ role: "user", content: "no tool_choice" }],
        tools: [
          {
            type: "function" as const,
            function: {
              name: "get_quotes",
              description: "q",
              parameters: { type: "object" }
            }
          }
        ],
        temperature: 0.2
      })
    );
    const params = (
      create.mock.calls[0] as unknown as [Record<string, unknown>]
    )[0];
    expect("tool_choice" in params).toBe(false);
  });

  it("contract fixture compression_payload.json's tool_choice is wire-compatible with create() payload shape", () => {
    // shared with apps/copilot/tests/fixtures/compression_payload.json — Python side asserts the same fixture's tool_choice/ tools shape.
    const fixturePath = resolve(
      __dirname,
      "../../../../apps/copilot/tests/fixtures/compression_payload.json"
    );
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
      tool_choice: unknown;
      tools: unknown;
    };
    expect(fixture.tool_choice).toEqual({
      type: "function",
      function: { name: "generate_structured_output" }
    });
    expect(Array.isArray(fixture.tools)).toBe(true);
    expect(fixture.tools).toHaveLength(1);
    const tool = (fixture.tools as Array<{ function: { name: string } }>)[0];
    expect(tool?.function.name).toBe("generate_structured_output");
  });

  it("LLM_HARD_TIMEOUT_CODE is pinned to the cross-layer literal (T-CH-01)", () => {
    // 单一来源漂移锁：worker internal/llm.ts 引用此常量写错误包络，
    // copilot Python 侧（gateway_client.py / chat.py / 测试）使用同一字面量解析与透传。
    // 任一侧改名 → worker 行为测试或 copilot 解析测试随之失败。
    expect(LLM_HARD_TIMEOUT_CODE).toBe("COPILOT_LLM_HARD_TIMEOUT");
  });
});

describe("ScrubbedLlmClient chatStream", () => {
  it("scrubs every message content (incl. tool role) and forwards signal untouched", async () => {
    const chatStream = vi.fn(async function* (
      _request: ChatStreamRequest
    ): AsyncIterable<ChatStreamDelta> {
      yield { type: "done" };
    });
    const inner = {
      chatJson: vi.fn(),
      embedding: vi.fn(),
      chatStream
    } as unknown as LlmClient;
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
    expect(forwarded?.messages[2]).toEqual({
      role: "assistant",
      content: "查一下"
    });
    expect(forwarded?.messages[3]).toMatchObject({
      role: "tool",
      tool_call_id: "t1"
    });
    expect(JSON.stringify(forwarded?.messages[3])).toContain(
      "[REDACTED:PHONE:"
    );
    expect(forwarded?.signal).toBe(signal);
  });

  it("throws two-arg LlmError and never calls inner when any message (tool role) blocks", async () => {
    const chatStream = vi.fn();
    const inner = {
      chatJson: vi.fn(),
      embedding: vi.fn(),
      chatStream
    } as unknown as LlmClient;
    const client = withScrubber(inner);

    await expect(
      collect(
        client.chatStream({
          messages: [
            { role: "user", content: "q" },
            {
              role: "tool",
              content: "内网 192.168.1.8 上的数据",
              tool_call_id: "t1"
            }
          ]
        })
      )
    ).rejects.toMatchObject({
      code: "SCRUBBER_BLOCKED",
      message: "scrubber blocked"
    });

    expect(chatStream).not.toHaveBeenCalled();
  });

  it("rejects with LlmError instance (class check)", async () => {
    const inner = {
      chatJson: vi.fn(),
      embedding: vi.fn(),
      chatStream: vi.fn()
    } as unknown as LlmClient;
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
