import type React from "react";

/**
 * copilot 回答的极简 Markdown 渲染。只覆盖模型实际会输出的子集：
 * `#`~`######` 标题、`-`/`*`/`1.` 列表（含二级缩进）、`**加粗**`、空行分段。
 * 文本经 React 转义，无 dangerouslySetInnerHTML，无 XSS 面。
 *
 * ponytail: 不支持表格/代码块/链接/引用块——真出现这些再换 react-markdown，
 * 别为当前这点语法提前装 micromark 那一串传递依赖。
 */

import { parseBlocks } from "./markdown-blocks";

const BOLD = /\*\*(.+?)\*\*/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  BOLD.lastIndex = 0;
  for (const match of text.matchAll(BOLD)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <strong className="font-semibold" key={`${keyPrefix}-b${start}`}>
        {match[1]}
      </strong>
    );
    cursor = start + match[0].length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-3 text-[15px] font-semibold first:mt-0",
  2: "mt-3 text-sm font-semibold first:mt-0",
  3: "mt-2.5 text-sm font-semibold first:mt-0",
};

// 缩进类必须写全字面量，Tailwind 扫不到模板拼出来的 `ml-${n}`。
const INDENT_CLASS = ["ml-4", "ml-8", "ml-12"] as const;

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="leading-6">
      {parseBlocks(text).map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p className={HEADING_CLASS[Math.min(3, block.level)]} key={index}>
              {inline(block.text, `h${index}`)}
            </p>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag
              className={`mt-1.5 flex flex-col gap-0.5 ${
                block.ordered ? "list-decimal" : "list-disc"
              }`}
              key={index}
            >
              {block.items.map((item, itemIndex) => (
                <li className={INDENT_CLASS[item.depth]} key={itemIndex}>
                  {inline(item.text, `l${index}-${itemIndex}`)}
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p className="mt-1.5 whitespace-pre-wrap first:mt-0" key={index}>
            {inline(block.text, `p${index}`)}
          </p>
        );
      })}
    </div>
  );
}
