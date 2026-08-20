import { describe, expect, it } from "vitest";
import { applySseEvent, createChatTurn, finishChatTurn } from "../chat-turn";
import { CHAT_DISCLAIMER, NO_CONCLUSION_NOTICE } from "../copy";

describe("chat-turn 一轮状态机", () => {
  it("_ack 记录 sessionId，普通工具帧只更新 toolName", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "tool", data: { name: "_ack", sessionId: 7 } });
    expect(turn.sessionId).toBe(7);
    expect(turn.toolName).toBeNull();
    turn = applySseEvent(turn, { type: "tool", data: { name: "search_items" } });
    expect(turn.toolName).toBe("search_items");
    expect(turn.sessionId).toBe(7);
  });

  it("token 追加文本，citation 按替换语义覆盖", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "token", data: "远东" });
    turn = applySseEvent(turn, { type: "token", data: "电缆" });
    expect(turn.text).toBe("远东电缆");
    turn = applySseEvent(turn, {
      type: "citation",
      data: [{ kind: "item", itemId: 1, title: "t", summaryZh: null, scoredAt: null, sourceName: "s" }]
    });
    expect(turn.citations).toHaveLength(1);
    turn = applySseEvent(turn, { type: "citation", data: [] });
    expect(turn.citations).toHaveLength(0);
  });

  it("done 落 status/sessionId/assistantMessageId，后续帧忽略", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "token", data: "结论" });
    turn = applySseEvent(turn, {
      type: "done",
      data: { sessionId: 3, assistantMessageId: 88 }
    });
    expect(turn.status).toBe("done");
    expect(turn.sessionId).toBe(3);
    expect(turn.assistantMessageId).toBe(88);
    const after = applySseEvent(turn, { type: "token", data: "多出来" });
    expect(after.text).toBe("结论");
  });

  it("error 帧带 code，之后 token 不再累积", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "error", data: { code: "SCRUBBER_BLOCKED" } });
    expect(turn.status).toBe("error");
    expect(turn.errorCode).toBe("SCRUBBER_BLOCKED");
    turn = applySseEvent(turn, { type: "token", data: "x" });
    expect(turn.text).toBe("");
  });

  it("流结束无 done/error → noConclusion（不把半段当结论）", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "token", data: "半段话" });
    const finished = finishChatTurn(turn);
    expect(finished.status).toBe("noConclusion");
    // 已 done/error 的轮次不受 finish 影响
    const doneTurn = applySseEvent(createChatTurn(), { type: "done", data: {} });
    expect(finishChatTurn(doneTurn).status).toBe("done");
  });

  it("无法识别的 data 形状不污染状态", () => {
    let turn = createChatTurn();
    turn = applySseEvent(turn, { type: "token", data: 123 });
    turn = applySseEvent(turn, { type: "citation", data: "nope" });
    turn = applySseEvent(turn, { type: "mystery", data: {} });
    expect(turn.text).toBe("");
    expect(turn.citations).toEqual([]);
    expect(turn.status).toBe("streaming");
  });
});

describe("写死文案常量", () => {
  it("页脚免责声明（两处 DOM 共用此常量，不可被 token 替换）", () => {
    expect(CHAT_DISCLAIMER).toBe("模型观点，仅供参考，不构成采购/交易建议");
  });

  it("无结论提示", () => {
    expect(NO_CONCLUSION_NOTICE).toBe("该轮不生成结论");
  });
});
