"use client";

import { useCopilot } from "./copilot-context";

import type { CopilotCitation } from "./sse";

function citationText(citation: CopilotCitation): { meta: string | null; title: string } {
  switch (citation.kind) {
    case "item":
      return { title: citation.title, meta: citation.sourceName };
    case "report":
      return { title: `日报 ${citation.date}`, meta: null };
    case "financials":
      return { title: citation.canonicalName, meta: citation.type };
    case "quotes":
      return { title: `${citation.symbol} · ${citation.metricKey}`, meta: null };
  }
}

/**
 * 依据卡列表：只渲染 button（type="button"），禁止锚点跳转。
 * 点击 item 卡 → setCitationItemId 打开引用弹层（原窗口 overlay，
 * 至多一层，换 id 不叠层；不得改会话状态）。
 */
export function CitationList({
  citations
}: {
  citations: CopilotCitation[];
}): React.JSX.Element | null {
  const { setCitationItemId } = useCopilot();
  if (citations.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {citations.map((citation, index) => {
        const text = citationText(citation);
        const isItem = citation.kind === "item";
        return (
          <li key={`${citation.kind}-${index}`}>
            <button
              className={`block w-full rounded-md border border-hairline p-2.5 text-left text-sm ${
                isItem ? "hover:bg-bg" : "cursor-default"
              }`}
              onClick={() => {
                if (citation.kind === "item") {
                  setCitationItemId(citation.itemId);
                }
              }}
              type="button"
            >
              <span className="font-medium text-fg">{text.title}</span>
              {text.meta ? (
                <span className="ml-2 text-xs text-fg-soft">{text.meta}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
