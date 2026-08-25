"use client";

import { useEffect, useRef, useState } from "react";
import { ThumbsDown, ThumbsUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applySseEvent, createChatTurn, finishChatTurn } from "./chat-turn";
import { CitationList } from "./citation-list";
import { CHAT_DISCLAIMER, NO_CONCLUSION_NOTICE } from "./copy";
import { Markdown } from "./markdown";
import { parseSseBuffer } from "./sse";

import type { ChatTurn } from "./chat-turn";
import type { CopilotCitation, CopilotMessageDto } from "./sse";

interface ChatMessageView {
  key: string;
  /** assistantMessageId（feedback 用）；user 行与本地占位为 null */
  id: number | null;
  role: "user" | "assistant";
  content: string;
  citations: CopilotCitation[];
  /** 该轮不生成结论 / 错误提示；有值时 content 不当结论渲染 */
  notice: string | null;
}

function isStaleTurn(input: {
  aborted: boolean;
  generation: number;
  currentGeneration: number;
  startedSessionId: number | null;
  currentSessionId: number | null;
}): boolean {
  return (
    input.aborted ||
    input.generation !== input.currentGeneration ||
    input.startedSessionId !== input.currentSessionId
  );
}

function toView(message: CopilotMessageDto): ChatMessageView {
  return {
    key: `m-${message.id}`,
    id: message.role === "assistant" ? message.id : null,
    role: message.role,
    content: message.content,
    citations: message.citations,
    notice: null
  };
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`;
  } catch {
    return `HTTP_${response.status}`;
  }
}

/**
 * 问答面板：`variant="page"`（/ask 主栏）与 `variant="drawer"`（详情同窗抽屉）。
 * POST /api/copilot/chat { sessionId?, itemId?, message }，消费 SSE
 * （tool/token/citation/done/error）。页脚免责声明两处 DOM 均写死，
 * 不可被模型 token 替换。
 */
export function ChatPanel({
  itemId = null,
  onBusy,
  onClose,
  onSessionId,
  sessionId,
  variant
}: {
  /** 详情会话首次发消息时携带；已有 sessionId 后只带 sessionId */
  itemId?: number | null;
  onBusy?: (busy: boolean) => void;
  /** drawer 变体的关闭按钮 */
  onClose?: () => void;
  /** _ack / done 带回新 sessionId 时上抛（续聊用） */
  onSessionId?: (sessionId: number) => void;
  sessionId: number | null;
  variant: "page" | "drawer";
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolName, setToolName] = useState<string | null>(null);
  const [rated, setRated] = useState<Record<number, 1 | -1>>({});
  const [reasonDraft, setReasonDraft] = useState<Record<number, string>>({});
  const [reasonOpen, setReasonOpen] = useState<number | null>(null);
  const keyCounter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  const generationRef = useRef(0);
  sessionIdRef.current = sessionId;

  // 切换会话：中断进行中的 turn；null → 清空；否则拉历史
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    setBusy(false);
    onBusy?.(false);
    setStreamingText("");
    setToolName(null);
    if (sessionId === null) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/copilot/sessions/${sessionId}/messages`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("messages failed"))
      )
      .then((data: { messages: CopilotMessageDto[] }) => {
        if (!cancelled) setMessages(data.messages.map(toView));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [onBusy, sessionId]);

  // 卸载（关抽屉）时中断未完成的流
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText, busy]);

  const nextKey = (prefix: string): string => {
    keyCounter.current += 1;
    return `${prefix}-${keyCounter.current}`;
  };

  const send = async (): Promise<void> => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    onBusy?.(true);
    setStreamingText("");
    setToolName(null);
    setMessages((prev) => [
      ...prev,
      { key: nextKey("u"), id: null, role: "user", content: message, citations: [], notice: null }
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;
    const startedSessionId = sessionId;
    const stale = (): boolean =>
      isStaleTurn({
        aborted: controller.signal.aborted,
        generation,
        currentGeneration: generationRef.current,
        startedSessionId,
        currentSessionId: sessionIdRef.current
      });
    onBusy?.(true);
    let turn: ChatTurn = createChatTurn();
    try {
      const response = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(sessionId !== null ? { sessionId } : {}),
          ...(sessionId === null && itemId !== null ? { itemId } : {}),
          message
        }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        // 非 2xx：BFF 原样透传 JSON error
        turn = { ...turn, status: "error", errorCode: await readErrorCode(response) };
      } else {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseBuffer(buffer);
          buffer = parsed.rest;
          for (const event of parsed.events) {
            turn = applySseEvent(turn, event);
          }
          if (stale()) return;
          setStreamingText(turn.text);
          setToolName(turn.toolName);
        }
        // 流结束无 done/error → noConclusion
        turn = finishChatTurn(turn);
      }
    } catch {
      if (stale()) return;
      turn = { ...turn, status: "error", errorCode: "NETWORK" };
    }

    if (stale()) return;
    setBusy(false);
    onBusy?.(false);
    setStreamingText("");
    setToolName(null);
    if (turn.status === "done") {
      setMessages((prev) => [
        ...prev,
        {
          key: nextKey("a"),
          id: turn.assistantMessageId,
          role: "assistant",
          content: turn.text,
          citations: turn.citations,
          notice: null
        }
      ]);
    } else {
      // error / noConclusion：不把半段当结论，只展示提示
      const notice =
        turn.status === "noConclusion"
          ? NO_CONCLUSION_NOTICE
          : `本轮未生成回答（${turn.errorCode ?? "ERROR"}）`;
      setMessages((prev) => [
        ...prev,
        { key: nextKey("n"), id: null, role: "assistant", content: "", citations: [], notice }
      ]);
    }
    if (turn.sessionId !== null && turn.sessionId !== sessionIdRef.current) {
      onSessionId?.(turn.sessionId);
    }
  };

  const postFeedback = async (
    messageId: number,
    rating: 1 | -1,
    reason: string | null
  ): Promise<void> => {
    try {
      await fetch(`/api/copilot/messages/${messageId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, reason })
      });
    } catch {
      // 反馈失败静默：不阻塞对话
    }
  };

  const sendFeedback = async (messageId: number, rating: 1 | -1): Promise<void> => {
    setRated((prev) => ({ ...prev, [messageId]: rating }));
    setReasonOpen(messageId);
    const reason = reasonDraft[messageId]?.trim() || null;
    await postFeedback(messageId, rating, reason);
  };

  const submitReason = async (messageId: number): Promise<void> => {
    const rating = rated[messageId];
    if (rating !== 1 && rating !== -1) return;
    const reason = reasonDraft[messageId]?.trim() || null;
    await postFeedback(messageId, rating, reason);
  };

  return (
    <div
      className={
        variant === "drawer"
          ? "flex h-full min-h-0 flex-col bg-surface"
          : "flex h-full min-h-0 flex-col rounded-md border border-border bg-surface"
      }
    >
      {variant === "drawer" ? (
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">
            {itemId !== null ? "帮我分析" : "问答"}
          </h2>
          {onClose ? (
            <button
              aria-label="关闭问答"
              className="grid h-9 w-9 place-items-center text-fg-muted hover:text-fg"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 space-y-4 overflow-y-auto p-4" ref={scrollRef}>
        {messages.length === 0 && !busy ? (
          <p className="pt-8 text-center text-sm text-fg-soft">
            就时间线里的行业情报提问，回答基于雷达已收录的数据。
          </p>
        ) : null}

        {messages.map((message) => (
          <div
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            key={message.key}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-md bg-accent/10 px-3 py-2 text-sm text-fg"
                  : "max-w-[85%] rounded-md border border-hairline bg-bg px-3 py-2 text-sm text-fg"
              }
            >
              {message.notice ? (
                <p className="text-fg-muted">{message.notice}</p>
              ) : message.role === "assistant" ? (
                <Markdown text={message.content} />
              ) : (
                <p className="whitespace-pre-wrap leading-6">{message.content}</p>
              )}
              {message.citations.length > 0 ? (
                <CitationList citations={message.citations} />
              ) : null}
              {message.role === "assistant" && message.id !== null ? (
                <div className="mt-2 flex gap-1 border-t border-hairline pt-2">
                  {([1, -1] as const).map((rating) => (
                    <button
                      aria-label={rating === 1 ? "有用" : "无用"}
                      className={`grid h-7 w-7 place-items-center rounded-[2px] ${
                        rated[message.id ?? 0] === rating
                          ? "text-accent"
                          : "text-fg-soft hover:text-fg-muted"
                      }`}
                      key={rating}
                      onClick={() => void sendFeedback(message.id ?? 0, rating)}
                      type="button"
                    >
                      {rating === 1 ? (
                        <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
                      ) : (
                        <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
              {message.role === "assistant" &&
              message.id !== null &&
              reasonOpen === message.id ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  <textarea
                    aria-label="反馈理由"
                    className="min-h-16 w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg"
                    maxLength={2000}
                    onChange={(event) => {
                      const id = message.id;
                      if (id === null) return;
                      setReasonDraft((prev) => ({ ...prev, [id]: event.target.value }));
                    }}
                    placeholder={
                      rated[message.id] === -1 ? "建议填写原因" : "可选填写理由"
                    }
                    value={reasonDraft[message.id] ?? ""}
                  />
                  <button
                    className="self-end text-xs text-accent"
                    onClick={() => {
                      if (message.id !== null) void submitReason(message.id);
                    }}
                    type="button"
                  >
                    提交理由
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {busy ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-md border border-hairline bg-bg px-3 py-2 text-sm text-fg">
              {streamingText ? (
                <Markdown text={streamingText} />
              ) : (
                <p className="text-fg-soft">
                  {toolName ? `正在查询（${toolName}）…` : "正在思考…"}
                </p>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="flex gap-2 border-t border-hairline p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="提问"
          className="min-h-10 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-soft focus:outline-none focus:ring-2 focus:ring-accent"
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="输入问题，Enter 发送"
          rows={1}
          value={input}
        />
        <Button disabled={busy || input.trim().length === 0} type="submit" variant="accent">
          发送
        </Button>
      </form>

      {/* 写死免责声明：两处 DOM（page / drawer）均有，不可被模型 token 替换 */}
      <p className="border-t border-hairline px-3 py-2 text-center text-[11px] text-fg-soft">
        {CHAT_DISCLAIMER}
      </p>
    </div>
  );
}
