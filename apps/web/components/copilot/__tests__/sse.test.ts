import { describe, expect, it } from "vitest";
import { ackSessionId, doneAssistantMessageId, parseSseBuffer } from "../sse";

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("parseSseBuffer（data: + JSON + \\n\\n 分帧）", () => {
  it("解析完整帧并清空 rest", () => {
    const { events, rest } = parseSseBuffer(
      frame({ type: "token", data: "你好" }) + frame({ type: "done", data: {} })
    );
    expect(rest).toBe("");
    expect(events.map((e) => e.type)).toEqual(["token", "done"]);
  });

  it("半帧留在 rest，下次拼上再解析", () => {
    const full = frame({ type: "token", data: "abc" });
    const cut = full.length - 5;
    const first = parseSseBuffer(full.slice(0, cut));
    expect(first.events).toHaveLength(0);
    expect(first.rest).toBe(full.slice(0, cut));
    const second = parseSseBuffer(first.rest + full.slice(cut));
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toEqual({ type: "token", data: "abc" });
  });

  it("非 data 行与坏 JSON 帧被跳过，不影响后续帧", () => {
    const buffer =
      ": comment\n\n" +
      "data: {not json}\n\n" +
      frame({ type: "tool", data: { name: "_ack", sessionId: 7 } });
    const { events } = parseSseBuffer(buffer);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("tool");
  });

  it("一帧内多行只取 data: 行", () => {
    const { events } = parseSseBuffer(
      `event: message\ndata: {"type":"token","data":"x"}\n\n`
    );
    expect(events).toEqual([{ type: "token", data: "x" }]);
  });
});

describe("ackSessionId", () => {
  it("tool 帧 name=_ack 取 sessionId", () => {
    expect(
      ackSessionId({ type: "tool", data: { name: "_ack", sessionId: 42 } })
    ).toBe(42);
  });

  it("非 _ack 工具帧返回 null", () => {
    expect(ackSessionId({ type: "tool", data: { name: "search_items" } })).toBeNull();
    expect(ackSessionId({ type: "token", data: "x" })).toBeNull();
  });
});

describe("doneAssistantMessageId", () => {
  it("done 帧取 assistantMessageId", () => {
    expect(
      doneAssistantMessageId({
        type: "done",
        data: { sessionId: 1, assistantMessageId: 99 }
      })
    ).toBe(99);
  });

  it("非 done 或缺字段返回 null", () => {
    expect(doneAssistantMessageId({ type: "done", data: {} })).toBeNull();
    expect(doneAssistantMessageId({ type: "error", data: { code: "X" } })).toBeNull();
  });
});
