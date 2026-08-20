/** 「帮我分析」渲染条件（写死）：copilotEnabled && item.copilotEligible && !citationMode */
export function shouldShowAnalyzeButton({
  citationMode = false,
  copilotEligible,
  copilotEnabled
}: {
  citationMode?: boolean;
  copilotEligible: boolean;
  copilotEnabled: boolean;
}): boolean {
  return copilotEnabled && copilotEligible && !citationMode;
}
