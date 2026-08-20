"use client";

import { Dialog } from "@/components/ui/dialog";
import { ChatPanel } from "./chat-panel";
import { useCopilot } from "./copilot-context";

/**
 * 聊天抽屉：原窗口右侧滑出（z-[60]），与时间线详情弹层同窗叠加。
 * enabled={chatOpen && citationItemId === null}：引用弹层打开时本层不响应
 * Escape/Tab、不抢焦点（Escape 只关顶层）。
 */
export function ChatDrawer(): React.JSX.Element | null {
  const {
    chatOpen,
    citationItemId,
    closeChat,
    contextItemId,
    sessionId,
    setSessionId
  } = useCopilot();

  return (
    <Dialog
      ariaLabel="Copilot 问答"
      enabled={chatOpen && citationItemId === null}
      onClose={closeChat}
      open={chatOpen}
      overlayClassName="z-[60] items-stretch justify-end"
      panelClassName="h-full w-full max-w-md shadow-pop"
    >
      <ChatPanel
        itemId={contextItemId}
        onClose={closeChat}
        onSessionId={setSessionId}
        sessionId={sessionId}
        variant="drawer"
      />
    </Dialog>
  );
}
