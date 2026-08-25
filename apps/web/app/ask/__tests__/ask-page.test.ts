import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 跑在 node 环境（无 jsdom / RSC runtime），页面行为改为源码级断言。
const read = (path: string): string => readFileSync(resolve(__dirname, path), "utf8");

const askPage = read("../page.tsx");
const forbiddenPage = read("../../forbidden.tsx");
const askChat = read("../ask-chat.tsx");

describe("/ask Server Component 灰度门", () => {
  it("evaluateCopilotAccess false → forbidden()（不先渲染再画 403）", () => {
    expect(askPage).toContain('import { forbidden } from "next/navigation"');
    expect(askPage).toContain("evaluateCopilotAccess(userId)");
    expect(askPage).toContain("if (!enabled)");
    expect(askPage).toContain("forbidden()");
  });

  it("灰度判定抛错 fail-closed", () => {
    expect(askPage).toContain("catch");
    expect(askPage).toContain("enabled = false");
  });

  it("全幅工作区 + 无页头 + ChatPanel page 变体", () => {
    expect(askPage).not.toContain("PageFrame");
    expect(askPage).not.toContain("PageHeader");
    expect(askPage).toContain("w-full");
    // 桌面与移动端都锁一屏高，输入框不靠滚动才能看见
    expect(askPage).toContain("h-[calc(100dvh-var(--shell-header-h))]");
    expect(askChat).toContain('variant="page"');
  });

  it("page 变体面板填满栅格高度，输入框不被挤出视口", () => {
    const chatPanel = read("../../../components/copilot/chat-panel.tsx");
    expect(chatPanel).toContain("flex h-full min-h-0 flex-col rounded-md");
    expect(chatPanel).not.toContain("min-h-[60dvh]");
  });

  it("会话区填满剩余高度且列表内部滚动", () => {
    expect(askChat).toContain("min-h-0 flex-1");
    expect(askChat).toContain("lg:grid-cols-[240px_minmax(0,1fr)]");
    expect(askChat).toContain("overflow-y-auto");
  });

  it("移动端历史会话默认折叠，选中会话后自动收起", () => {
    expect(askChat).toContain("useState(false)");
    expect(askChat).toContain("aria-expanded={listOpen}");
    expect(askChat).toContain("lg:hidden");
    expect(askChat).toContain('${listOpen ? "flex" : "hidden"}');
    expect(askChat).toContain("setListOpen(false)");
  });

  it("会话列表 GET /api/copilot/sessions", () => {
    expect(askChat).toContain('fetch("/api/copilot/sessions")');
  });

  it("busy 时禁用侧栏切会话", () => {
    expect(askChat).toContain("disabled={chatBusy}");
    expect(askChat).toContain("onBusy={setChatBusy}");
  });
});

describe("forbidden.tsx", () => {
  it("写死文案「Copilot 未对当前账号开放」", () => {
    expect(forbiddenPage).toContain("Copilot 未对当前账号开放");
  });
});
