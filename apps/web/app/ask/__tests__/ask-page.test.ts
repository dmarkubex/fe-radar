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

  it("PageFrame + PageHeader compact + ChatPanel page 变体", () => {
    expect(askPage).toContain("<PageFrame>");
    expect(askPage).toContain('eyebrow="问时间线"');
    expect(askPage).toContain('title="问答"');
    expect(askPage).toContain('variant="compact"');
    expect(askChat).toContain('variant="page"');
  });

  it("会话列表 GET /api/copilot/sessions", () => {
    expect(askChat).toContain('fetch("/api/copilot/sessions")');
  });
});

describe("forbidden.tsx", () => {
  it("写死文案「Copilot 未对当前账号开放」", () => {
    expect(forbiddenPage).toContain("Copilot 未对当前账号开放");
  });
});
