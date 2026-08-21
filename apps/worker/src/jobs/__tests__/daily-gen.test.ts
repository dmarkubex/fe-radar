import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_TIMEZONE, dayjs, LlmError } from "@fe-radar/shared";
import { buildDailyReportInput, DAILY_REPORT_BLOCKED_SUMMARY, dailyPublishedSince, runDailyGen, type DailyInputItem } from "../daily-gen";

import type { LlmClient, DailyReportResult } from "@fe-radar/llm";

let scrubbedChatJson: ((request: unknown) => Promise<unknown>) | null = null;

vi.mock("@fe-radar/llm", async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    get withScrubber() {
      return () => ({ chatJson: (req: unknown) => scrubbedChatJson?.(req) });
    },
    assertKimiContext: vi.fn()
  };
});

// S4 / T-SEC-09: loadProjectCodes is fail-closed when never loaded + DB fails.
// Job tests mock a deterministic codes list so scrubber path is exercised without real DB.
// Do not set DATABASE_URL or weaken production fail-closed.
vi.mock("../../handlers/context", () => ({
  loadProjectCodes: vi.fn().mockResolvedValue(["ZX-01"]),
}));

function mockSelectChain(resolvedValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(resolvedValue);
  return { select: vi.fn().mockReturnValue(chain) };
}

function mockInsertChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  return chain;
}

function cleanItems(count: number): DailyInputItem[] {
  return Array.from({ length: count }, (_, index) => ({
    title: `item-${index}`,
    sourceName: "北极星",
    category: "项目与招投标",
    summaryZh: "摘要",
    scoredAt: new Date("2026-08-20T00:00:00Z"),
    publishedAt: new Date("2026-08-20T00:00:00Z")
  }));
}

function llmReport(sections: DailyReportResult["sections"]) {
  return {
    value: { sections },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costCny: 0 },
    provider: "kimi"
  };
}

describe("daily-gen", () => {
  afterEach(() => {
    scrubbedChatJson = null;
  });

  it("builds five-section prompt input from curated items", () => {
    const input = buildDailyReportInput([{ title: "储能项目", sourceName: "北极星", category: "项目与招投标", summaryZh: "中标摘要", scoredAt: new Date("2026-05-11T00:00:00Z"), publishedAt: new Date("2026-05-10T16:00:00Z") }]);
    expect(input).toContain("标题：储能项目");
    expect(input).toContain("摘要：中标摘要");
    expect(input).toContain("发布时间：2026-05-11 00:00");
  });

  it("dailyPublishedSince is start of previous calendar day in Asia/Shanghai", () => {
    const since = dailyPublishedSince(new Date("2026-08-21T08:00:00+08:00"));
    expect(dayjs(since).tz(APP_TIMEZONE).format("YYYY-MM-DD HH:mm")).toBe("2026-08-20 00:00");
  });

  it("回代 2026-08-21 08:00：阿曼/光纤棒/8月19日股价均早于昨天 0 点", () => {
    const since = dailyPublishedSince(new Date("2026-08-21T08:00:00+08:00")).getTime();
    expect(new Date("2026-08-14T09:58:00+08:00").getTime()).toBeLessThan(since);
    expect(new Date("2026-08-18T12:44:00+08:00").getTime()).toBeLessThan(since);
    expect(new Date("2026-08-18T13:56:00+08:00").getTime()).toBeLessThan(since);
    expect(new Date("2026-08-19T00:00:00+08:00").getTime()).toBeLessThan(since);
    expect(new Date("2026-08-20T00:00:00+08:00").getTime()).toBeGreaterThanOrEqual(since);
  });

  it("loadDailyInput filters scoredAt 24h and publishedAt yesterday 00:00", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../daily-gen.ts"),
      "utf8"
    );
    expect(source).toContain("gte(itemAnalysis.scoredAt, scoredSince)");
    expect(source).toContain("gte(items.publishedAt, publishedSince)");
  });

  it("pauses when too many items need manual scrub", async () => {
    const blockedItems: DailyInputItem[] = Array.from({ length: 5 }, (_, index) => ({
      title: `item-${index}`,
      sourceName: "source",
      category: "公司与资本",
      summaryZh: DAILY_REPORT_BLOCKED_SUMMARY,
      scoredAt: new Date(),
      publishedAt: new Date()
    }));
    const select = mockSelectChain(blockedItems);
    const insertChain = mockInsertChain();
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;
    await expect(runDailyGen(llm, { db: db as never })).rejects.toBeInstanceOf(LlmError);
    expect(llm.chatJson).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("calls scrubbed LLM and saves report when items are clean", async () => {
    const sections: DailyReportResult["sections"] = { market: "储能项目相关内容" };
    scrubbedChatJson = vi.fn().mockResolvedValue(llmReport(sections));

    const select = mockSelectChain(cleanItems(1));
    const insertChain = mockInsertChain();
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;
    const result = await runDailyGen(llm, { db: db as never });
    expect(result).not.toBeNull();
    expect(result?.sections).toHaveProperty("market");
    expect(db.insert).toHaveBeenCalled();
  });

  it("skips LLM and insert when loadDailyInput returns no curated items (2026-08-20 regression)", async () => {
    scrubbedChatJson = vi.fn();
    const select = mockSelectChain([]);
    const insertChain = mockInsertChain();
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;

    await expect(runDailyGen(llm, {
      db: db as never,
      now: new Date("2026-08-20T08:00:10+08:00")
    })).resolves.toBeNull();

    expect(llm.chatJson).not.toHaveBeenCalled();
    expect(scrubbedChatJson).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("calls LLM once and writes report when three curated items exist", async () => {
    const sections: DailyReportResult["sections"] = { market: "三条料的正常日报" };
    scrubbedChatJson = vi.fn().mockResolvedValue(llmReport(sections));
    const select = mockSelectChain(cleanItems(3));
    const insertChain = mockInsertChain();
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;

    const result = await runDailyGen(llm, { db: db as never });
    expect(result).toEqual({ sections });
    expect(scrubbedChatJson).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(insertChain.values).toHaveBeenCalledTimes(1);
  });

  it("skips insert when LLM returns empty sections", async () => {
    scrubbedChatJson = vi.fn().mockResolvedValue(llmReport({
      tech: "",
      market: "  ",
      policy: "",
      company: "",
      project: ""
    }));
    const select = mockSelectChain(cleanItems(1));
    const insertChain = mockInsertChain();
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;

    await expect(runDailyGen(llm, { db: db as never })).resolves.toBeNull();
    expect(scrubbedChatJson).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing same-day report when input is empty", async () => {
    const reportDate = "2026-08-20";
    const existingSections = { market: "已有内容", policy: "政策摘要" };
    const store = new Map<string, DailyReportResult["sections"]>([
      [reportDate, { ...existingSections }]
    ]);

    scrubbedChatJson = vi.fn();
    const select = mockSelectChain([]);
    const insertChain = mockInsertChain();
    insertChain.values = vi.fn((values: { date: string; sections: DailyReportResult["sections"] }) => {
      store.set(values.date, values.sections);
      return insertChain;
    });
    insertChain.onConflictDoUpdate = vi.fn((args: { set: { sections: DailyReportResult["sections"] } }) => {
      store.set(reportDate, args.set.sections);
      return Promise.resolve(undefined);
    });
    const db = { ...select, insert: vi.fn().mockReturnValue(insertChain) };
    const llm = { chatJson: vi.fn() } as unknown as LlmClient;

    await expect(runDailyGen(llm, {
      db: db as never,
      now: new Date("2026-08-20T08:00:10+08:00")
    })).resolves.toBeNull();

    expect(llm.chatJson).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(store.get(reportDate)).toEqual(existingSections);
  });
});
