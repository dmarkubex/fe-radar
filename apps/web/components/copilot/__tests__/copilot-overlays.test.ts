import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 跑在 node 环境（无 jsdom），组件渲染行为改为源码级断言。
const dir = resolve(__dirname, "..");
const read = (name: string): string => readFileSync(resolve(dir, name), "utf8");

const citationList = read("citation-list.tsx");
const citationDialog = read("citation-dialog.tsx");
const chatDrawer = read("chat-drawer.tsx");
const chatPanel = read("chat-panel.tsx");
const provider = read("copilot-provider.tsx");
const itemDetailDialog = readFileSync(
  resolve(__dirname, "../../timeline/item-detail-dialog.tsx"),
  "utf8"
);

describe("citation-list 引用卡", () => {
  it("只有 <button type=\"button\">，禁止 <a> / href / window.open", () => {
    expect(citationList).not.toContain("<a");
    expect(citationList).not.toContain("href");
    expect(citationList).not.toContain("window.open");
    expect(citationList).toContain('type="button"');
  });

  it("item 卡渲染 summaryZh", () => {
    expect(citationList).toContain("summaryZh");
    expect(citationList).toContain("text.summary");
  });

  it("点击 item 卡走 setCitationItemId（原窗口 overlay）", () => {
    expect(citationList).toContain("setCitationItemId(citation.itemId)");
  });
});

describe("CitationDialog 引用弹层", () => {
  it("只 GET /api/copilot/cite/:id，禁止 /api/items/:id 与 cluster", () => {
    expect(citationDialog).toContain("/api/copilot/cite/");
    expect(citationDialog).not.toContain("/api/items/");
    expect(citationDialog).not.toContain("clusterItems");
  });

  it("citationMode：无帮我分析；不改 sessionId / contextItemId", () => {
    expect(citationDialog).not.toContain("AnalyzeButton");
    expect(citationDialog).not.toContain("setSessionId");
    expect(citationDialog).not.toContain("contextItemId");
  });

  it("z-[70]，enabled 跟随 citationItemId", () => {
    expect(citationDialog).toContain("z-[70]");
    expect(citationDialog).toContain("enabled={citationItemId !== null}");
  });
});

describe("ChatDrawer 抽屉", () => {
  it("z-[60]，引用打开时本层失能（Escape 只关顶层）", () => {
    expect(chatDrawer).toContain("z-[60]");
    expect(chatDrawer).toContain("enabled={chatOpen && citationItemId === null}");
  });

  it("禁止新开窗口", () => {
    expect(chatDrawer).not.toContain("window.open");
    expect(chatDrawer).not.toContain('target="_blank"');
  });
});

describe("ChatPanel", () => {
  it("POST /api/copilot/chat，页脚写死免责声明", () => {
    expect(chatPanel).toContain('fetch("/api/copilot/chat"');
    expect(chatPanel).toContain("CHAT_DISCLAIMER");
    expect(chatPanel).toContain("NO_CONCLUSION_NOTICE");
  });

  it("feedback 走 POST /api/copilot/messages/:id/feedback", () => {
    expect(chatPanel).toContain("/feedback");
    expect(chatPanel).toContain("{ rating, reason }");
    expect(chatPanel).toContain("建议填写原因");
  });

  it("sessionId 变化时 abort，过期 turn 不得 setMessages / onSessionId", () => {
    expect(chatPanel).toContain("abortRef.current?.abort()");
    expect(chatPanel).toContain("function isStaleTurn");
    expect(chatPanel).toContain("if (stale()) return");
    expect(chatPanel).toContain("sessionIdRef.current");
    expect(chatPanel).toContain("generation !== input.currentGeneration");
    expect(chatPanel).toContain("startedSessionId !== input.currentSessionId");
  });
});

describe("弹窗协调接线", () => {
  it("Provider 全局挂载 ChatDrawer 与 CitationDialog", () => {
    expect(provider).toContain("<ChatDrawer />");
    expect(provider).toContain("<CitationDialog />");
  });

  it("时间线 ItemDetailDialog：enabled 跟随 chatOpen/citationItemId，z-50 保持", () => {
    expect(itemDetailDialog).toContain("enabled={!chatOpen && citationItemId === null}");
    expect(itemDetailDialog).not.toContain("z-[60]");
    expect(itemDetailDialog).not.toContain("z-[70]");
  });
});
