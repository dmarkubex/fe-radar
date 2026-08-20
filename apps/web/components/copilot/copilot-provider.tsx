"use client";

import { useCallback, useMemo, useState } from "react";
import { ChatDrawer } from "./chat-drawer";
import { CitationDialog } from "./citation-dialog";
import { CopilotContext } from "./copilot-context";

import type { CopilotContextValue } from "./copilot-context";

/**
 * Copilot 全局状态：chatOpen / sessionId / contextItemId / citationItemId。
 * 只挂在 AppShell 已登录分支内、包住 {children}（/auth/login 不经 AppShell，不挂）。
 */
export function CopilotProvider({
  children,
  enabled
}: {
  children: React.ReactNode;
  enabled: boolean;
}): React.JSX.Element {
  const [chatOpen, setChatOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [contextItemId, setContextItemId] = useState<number | null>(null);
  const [citationItemId, setCitationItemId] = useState<number | null>(null);

  const openItemChat = useCallback((itemId: number) => {
    setContextItemId(itemId);
    setSessionId(null);
    setChatOpen(true);
  }, []);

  const openSession = useCallback((nextSessionId: number) => {
    setSessionId(nextSessionId);
    setContextItemId(null);
    setChatOpen(true);
  }, []);

  const startNewChat = useCallback(() => {
    setSessionId(null);
    setContextItemId(null);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
  }, []);

  const value = useMemo<CopilotContextValue>(
    () => ({
      enabled,
      chatOpen,
      sessionId,
      contextItemId,
      citationItemId,
      openItemChat,
      openSession,
      startNewChat,
      closeChat,
      setSessionId,
      setCitationItemId
    }),
    [
      enabled,
      chatOpen,
      sessionId,
      contextItemId,
      citationItemId,
      openItemChat,
      openSession,
      startNewChat,
      closeChat
    ]
  );

  return (
    <CopilotContext.Provider value={value}>
      {children}
      {/* 聊天抽屉（z-[60]）与引用弹层（z-[70]）全局挂载，同窗叠加 */}
      <ChatDrawer />
      <CitationDialog />
    </CopilotContext.Provider>
  );
}
