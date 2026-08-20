import { ackSessionId, doneAssistantMessageId } from "./sse";

import type { CopilotCitation, CopilotSseEvent } from "./sse";

export type ChatTurnStatus = "streaming" | "done" | "error" | "noConclusion";

/**
 * 一轮问答的累积状态（纯函数，便于 vitest node 环境断言）。
 * SSE 事件序列：tool(_ack/工具名) → token* → citation → done | error。
 * 流结束但无 done/error → finishChatTurn 置 noConclusion，不把半段当结论。
 */
export interface ChatTurn {
  status: ChatTurnStatus;
  /** token 帧累积的回答文本 */
  text: string;
  /** citation 帧按替换语义覆盖 */
  citations: CopilotCitation[];
  /** _ack / done 帧带回的 sessionId（续聊用） */
  sessionId: number | null;
  /** done 帧的 assistantMessageId（feedback 用） */
  assistantMessageId: number | null;
  errorCode: string | null;
  /** 最近一个非 _ack 工具名（等待态提示用） */
  toolName: string | null;
}

export function createChatTurn(): ChatTurn {
  return {
    status: "streaming",
    text: "",
    citations: [],
    sessionId: null,
    assistantMessageId: null,
    errorCode: null,
    toolName: null
  };
}

export function applySseEvent(turn: ChatTurn, event: CopilotSseEvent): ChatTurn {
  // done/error 之后的帧一律忽略
  if (turn.status !== "streaming") return turn;
  switch (event.type) {
    case "tool": {
      const ack = ackSessionId(event);
      if (ack !== null) return { ...turn, sessionId: ack };
      const data = event.data as { name?: unknown } | undefined;
      return typeof data?.name === "string" ? { ...turn, toolName: data.name } : turn;
    }
    case "token": {
      return typeof event.data === "string"
        ? { ...turn, text: turn.text + event.data }
        : turn;
    }
    case "citation": {
      return Array.isArray(event.data)
        ? { ...turn, citations: event.data as CopilotCitation[] }
        : turn;
    }
    case "done": {
      const data = event.data as { sessionId?: unknown } | undefined;
      return {
        ...turn,
        status: "done",
        assistantMessageId: doneAssistantMessageId(event),
        sessionId: typeof data?.sessionId === "number" ? data.sessionId : turn.sessionId
      };
    }
    case "error": {
      const data = event.data as { code?: unknown } | undefined;
      return {
        ...turn,
        status: "error",
        errorCode: typeof data?.code === "string" ? data.code : null
      };
    }
    default:
      return turn;
  }
}

/** 流结束但无 done/error：清等待态、标 noConclusion（UI 展示「该轮不生成结论」） */
export function finishChatTurn(turn: ChatTurn): ChatTurn {
  if (turn.status !== "streaming") return turn;
  return { ...turn, status: "noConclusion" };
}
