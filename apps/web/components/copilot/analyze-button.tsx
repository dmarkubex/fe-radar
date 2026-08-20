"use client";

import { Button } from "@/components/ui/button";
import { useCopilot } from "./copilot-context";
import { shouldShowAnalyzeButton } from "./visibility";

export { shouldShowAnalyzeButton } from "./visibility";

/**
 * 「帮我分析」按钮：详情页与时间线弹层共用。点击在原窗口打开聊天抽屉
 * （chatOpen=true，详情会话带 itemId），禁止 target=_blank / window.open。
 * 引用弹层（citationMode）内不渲染。
 */
export function AnalyzeButton({
  citationMode = false,
  className,
  copilotEligible,
  itemId
}: {
  citationMode?: boolean;
  className?: string;
  copilotEligible: boolean;
  itemId: number;
}): React.JSX.Element | null {
  const { enabled, openItemChat } = useCopilot();
  if (!shouldShowAnalyzeButton({ citationMode, copilotEligible, copilotEnabled: enabled })) {
    return null;
  }
  return (
    <Button
      className={className}
      onClick={() => openItemChat(itemId)}
      type="button"
      variant="outline"
    >
      帮我分析
    </Button>
  );
}
