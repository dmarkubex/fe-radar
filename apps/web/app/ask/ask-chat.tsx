"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatPanel } from "@/components/copilot/chat-panel";
import { formatAppTime } from "@/components/timeline/meta";

import type { CopilotSessionDto } from "@/components/copilot/sse";

/**
 * /ask 主区：会话列表（GET /api/copilot/sessions）+ ChatPanel variant="page"。
 * 选中会话 / 新会话只改本地 activeSessionId，不碰全局 CopilotProvider 状态
 * （抽屉会话与 /ask 会话互不干扰）。
 */
export function AskChat(): React.JSX.Element {
  const [sessions, setSessions] = useState<CopilotSessionDto[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [chatBusy, setChatBusy] = useState(false);

  const refreshSessions = useCallback(() => {
    fetch("/api/copilot/sessions")
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("sessions failed"))
      )
      .then((data: { sessions: CopilotSessionDto[] }) => {
        setSessions(data.sessions);
      })
      .catch(() => {
        setSessions([]);
      });
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-2 lg:min-h-0">
        <button
          className="rounded-md border border-border bg-surface px-3 py-2 text-left text-sm font-medium text-fg hover:bg-bg-deep disabled:opacity-50"
          disabled={chatBusy}
          onClick={() => setActiveSessionId(null)}
          type="button"
        >
          ＋ 新会话
        </button>
        <ul className="flex flex-col gap-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className={`block w-full rounded-md border px-3 py-2 text-left text-sm ${
                  activeSessionId === session.id
                    ? "border-accent bg-accent/5 text-fg"
                    : "border-hairline text-fg-muted hover:bg-bg"
                }`}
                disabled={chatBusy}
                onClick={() => setActiveSessionId(session.id)}
                type="button"
              >
                <span className="block truncate font-medium">
                  {session.title ?? "未命名会话"}
                </span>
                <span className="mt-0.5 block text-[11px] text-fg-soft">
                  {session.source === "item" && session.itemId === null
                    ? "原条目已过期 · "
                    : ""}
                  {formatAppTime(session.lastActive)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <ChatPanel
        onBusy={setChatBusy}
        onSessionId={(nextSessionId) => {
          setActiveSessionId(nextSessionId);
          refreshSessions();
        }}
        sessionId={activeSessionId}
        variant="page"
      />
    </div>
  );
}
