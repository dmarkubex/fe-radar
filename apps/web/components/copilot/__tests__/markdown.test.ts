import { describe, expect, it } from "vitest";
import { parseBlocks } from "@/components/copilot/markdown-blocks";

describe("parseBlocks", () => {
  it("拆出标题/列表/段落，二级缩进保留 depth", () => {
    const blocks = parseBlocks(
      [
        "根据雷达检索到的信息：",
        "",
        "### 1. 非公开发行",
        "- **2026年7月28日**：募资不超过 **20亿元**",
        "  - AIDC 光纤",
        "",
        "尾注一行。",
      ].join("\n")
    );

    expect(blocks).toEqual([
      { kind: "paragraph", text: "根据雷达检索到的信息：" },
      { kind: "heading", level: 3, text: "1. 非公开发行" },
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, text: "**2026年7月28日**：募资不超过 **20亿元**" },
          { depth: 1, text: "AIDC 光纤" },
        ],
      },
      { kind: "paragraph", text: "尾注一行。" },
    ]);
  });

  it("列表紧跟正文时不吞掉后面的段落", () => {
    const blocks = parseBlocks("- 一条\n结论句。");
    expect(blocks.map((b) => b.kind)).toEqual(["list", "paragraph"]);
  });

  it("有序列表识别为 ordered", () => {
    const blocks = parseBlocks("1. 甲\n2. 乙");
    expect(blocks[0]).toEqual({
      kind: "list",
      ordered: true,
      items: [
        { depth: 0, text: "甲" },
        { depth: 0, text: "乙" },
      ],
    });
  });

  it("纯文本原样成段，多行合并保留换行", () => {
    expect(parseBlocks("第一行\n第二行")).toEqual([
      { kind: "paragraph", text: "第一行\n第二行" },
    ]);
  });
});
