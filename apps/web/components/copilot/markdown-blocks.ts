/**
 * copilot 回答的极简 Markdown 分块（纯函数，无 JSX，便于单测）。
 * 渲染见 markdown.tsx。
 */

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; items: { depth: number; text: string }[] }
  | { kind: "paragraph"; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^(\s*)(?:[-*]|\d+[.)])\s+(.*)$/;

export function parseBlocks(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { kind: "list" }> | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const line of source.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: (heading[1] ?? "").length, text: heading[2] ?? "" });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushParagraph();
      const depth = Math.min(2, Math.floor((item[1] ?? "").replace(/\t/g, "  ").length / 2));
      if (!list) {
        list = { kind: "list", ordered: /^\s*\d/.test(line), items: [] };
      }
      list.items.push({ depth, text: item[2] ?? "" });
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
