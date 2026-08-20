/** 与 §5 citation 联合类型一致（T-CA-07 BFF / copilot 端契约） */
export type CopilotCitation =
  | {
      kind: "item";
      itemId: number;
      title: string;
      summaryZh: string | null;
      scoredAt: string | null;
      sourceName: string;
    }
  | { kind: "report"; date: string }
  | { kind: "financials"; entityId: number; canonicalName: string; type: string }
  | { kind: "quotes"; symbol: "CU" | "LC"; metricKey: string };

export interface CopilotSseEvent {
  type: string;
  data?: unknown;
}

export interface CopilotSessionDto {
  id: number;
  title: string | null;
  source: "ask" | "item";
  itemId: number | null;
  lastActive: string;
  createdAt: string;
}

export interface CopilotMessageDto {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: CopilotCitation[];
  createdAt: string;
}

/**
 * SSE 分帧解析（`data: ` + JSON + `\n\n`，与 T-CA-07 BFF 一致）。
 * 输入增量 buffer，返回已完整解析的事件与尚未成帧的剩余 buffer。
 */
export function parseSseBuffer(buffer: string): {
  events: CopilotSseEvent[];
  rest: string;
} {
  const events: CopilotSseEvent[] = [];
  let rest = buffer;
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary === -1) break;
    const frame = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const parsed = JSON.parse(line.slice(6)) as CopilotSseEvent;
        if (parsed && typeof parsed.type === "string") {
          events.push(parsed);
        }
      } catch {
        // 忽略无法解析的帧，继续后续帧
      }
    }
  }
  return { events, rest };
}

/** tool 帧中 name === "_ack" 时取出 sessionId（续聊用），否则返回 null */
export function ackSessionId(event: CopilotSseEvent): number | null {
  if (event.type !== "tool") return null;
  const data = event.data as { name?: unknown; sessionId?: unknown } | undefined;
  if (data?.name !== "_ack" || typeof data.sessionId !== "number") return null;
  return data.sessionId;
}

/** done 帧中的 assistantMessageId（feedback 用），缺失返回 null */
export function doneAssistantMessageId(event: CopilotSseEvent): number | null {
  if (event.type !== "done") return null;
  const data = event.data as { assistantMessageId?: unknown } | undefined;
  return typeof data?.assistantMessageId === "number" ? data.assistantMessageId : null;
}
