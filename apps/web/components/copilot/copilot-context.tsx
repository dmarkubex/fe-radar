"use client";

import { createContext, useContext } from "react";

export interface CopilotContextValue {
  /** 灰度：copilotEnabled（layout 评估后经 AppShell 下发） */
  enabled: boolean;
  chatOpen: boolean;
  sessionId: number | null;
  contextItemId: number | null;
  citationItemId: number | null;
  /** 「帮我分析」：围绕条目开新会话（原窗口抽屉，禁止新开窗口） */
  openItemChat: (itemId: number) => void;
  openSession: (sessionId: number) => void;
  startNewChat: () => void;
  closeChat: () => void;
  setSessionId: (sessionId: number | null) => void;
  setCitationItemId: (itemId: number | null) => void;
}

const noop = (): void => {};

/** 无 Provider（如未登录分支）时的安全默认值：一切关闭、动作空操作 */
export const COPILOT_DEFAULT_CONTEXT: CopilotContextValue = {
  enabled: false,
  chatOpen: false,
  sessionId: null,
  contextItemId: null,
  citationItemId: null,
  openItemChat: noop,
  openSession: noop,
  startNewChat: noop,
  closeChat: noop,
  setSessionId: noop,
  setCitationItemId: noop
};

export const CopilotContext = createContext<CopilotContextValue>(COPILOT_DEFAULT_CONTEXT);

export function useCopilot(): CopilotContextValue {
  return useContext(CopilotContext);
}
