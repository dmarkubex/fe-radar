/**
 * A-12: withScrubber 使用真实中间件（不 identity mock）。
 * mockRunPrefilter 调用 client.chatJson({ user })，断言最终 payload 无原始代号。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as FeRadarLlm from "@fe-radar/llm";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before module resolution
// ---------------------------------------------------------------------------

const {
  mockGetDb,
  mockRunPrefilter,
  mockLoadProjectCodes,
  fakeQwen,
  fakeDeepSeek,
  capturedUsers,
} = vi.hoisted(() => {
  const capturedUsers: string[] = [];
  const makeClient = () => ({
    chatJson: vi.fn(async (req: { user: string }) => {
      capturedUsers.push(req.user);
      return { value: { isIndustryRelated: true, reason: "ok" }, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }),
    embedding: vi.fn(async () => {
      throw new Error("embedding not used");
    }),
  });
  return {
    mockGetDb: vi.fn(),
    mockRunPrefilter: vi.fn(),
    mockLoadProjectCodes: vi.fn(),
    fakeQwen: makeClient(),
    fakeDeepSeek: makeClient(),
    capturedUsers,
  };
});

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title", content: "items.content" },
  itemAnalysis: {
    itemId: "ia.item_id",
    isIndustryRelated: "ia.is_industry_related",
    isCurated: "ia.is_curated",
    alertType: "ia.alert_type",
    alertLevel: "ia.alert_level",
    quotaState: "ia.quota_state",
  },
}));

// 真实 withScrubber
vi.mock("@fe-radar/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarLlm>();
  return { ...actual, withScrubber: actual.withScrubber };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}));

vi.mock("../../jobs/prefilter", () => ({
  runPrefilter: mockRunPrefilter,
}));

vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: fakeQwen, deepSeek: fakeDeepSeek },
  loadProjectCodes: mockLoadProjectCodes,
}));

// ---------------------------------------------------------------------------
// DB chainable mock helpers
// ---------------------------------------------------------------------------

function makeDb(selectRows: unknown[]) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(selectRows),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: updateSet })),
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

import { handlePrefilterJob } from "../prefilter";

/** mock 必须真正调 client.chatJson，真实 scrubber 才会改写 user。 */
function wirePrefilterThroughClient(
  result: { isIndustryRelated: boolean | "unknown"; reason: string } = { isIndustryRelated: true, reason: "电力" },
) {
  mockRunPrefilter.mockImplementation(
    async (
      input: { title: string; content: string },
      qwen: { chatJson: (r: unknown) => Promise<unknown> },
      _fallback: { chatJson: (r: unknown) => Promise<unknown> },
    ) => {
      await qwen.chatJson({
        system: "prefilter",
        user: `${input.title}\n${input.content}`,
        schemaName: "prefilter",
        schema: { type: "object" },
      });
      return result;
    },
  );
}

describe("handlePrefilterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUsers.length = 0;
    mockLoadProjectCodes.mockResolvedValue(["内部代号A"]);
    wirePrefilterThroughClient();
  });

  it("normal path: writes isIndustryRelated=true when runPrefilter returns true", async () => {
    const db = makeDb([{ title: "电网投资", content: "正文" }]);

    await handlePrefilterJob({ data: { itemId: 42 } as never });

    expect(mockRunPrefilter).toHaveBeenCalledTimes(1);
    expect(db._updateSet).toHaveBeenCalledWith({ isIndustryRelated: true });
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("boundary: 'unknown' result clears presentation state and remains pending", async () => {
    const db = makeDb([{ title: "无关新闻", content: null }]);
    wirePrefilterThroughClient({ isIndustryRelated: "unknown", reason: "x" });

    await handlePrefilterJob({ data: { itemId: 7 } as never });

    // content null → falls back to title; unknown stays pending.
    expect(mockRunPrefilter).toHaveBeenCalledWith(
      { title: "无关新闻", content: "无关新闻" },
      expect.anything(),
      expect.anything(),
    );
    expect(db._updateSet).toHaveBeenCalledWith({
      isIndustryRelated: null,
      isCurated: false,
      alertType: null,
      alertLevel: null,
    });
  });

  it("explicit false result → isIndustryRelated=false", async () => {
    const db = makeDb([{ title: "美股大盘", content: "无关内容" }]);
    wirePrefilterThroughClient({ isIndustryRelated: false, reason: "not industry" });

    await handlePrefilterJob({ data: { itemId: 5 } as never });

    expect(db._updateSet).toHaveBeenCalledWith({
      isIndustryRelated: false,
      isCurated: false,
      alertType: null,
      alertLevel: null,
      quotaState: "dropped_filter",
    });
  });

  it("empty path: item not found → warns and does not call runPrefilter or update", async () => {
    const db = makeDb([]);
    await handlePrefilterJob({ data: { itemId: 999 } as never });

    expect(mockRunPrefilter).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // T-SEC-09: 项目代号字典必须按 job 即时加载
  it("loads project codes per job", async () => {
    makeDb([{ title: "电网投资", content: "正文" }]);

    await handlePrefilterJob({ data: { itemId: 1 } as never });
    await handlePrefilterJob({ data: { itemId: 2 } as never });

    expect(mockLoadProjectCodes).toHaveBeenCalledTimes(2);
  });

  // A-12: 真实 withScrubber — 原始代号不得出现在最终 LLM payload
  it("A-12: real withScrubber redacts project codes in final chatJson user payload", async () => {
    const CODE = "预筛内部代号PRE-99";
    mockLoadProjectCodes.mockResolvedValue([CODE]);
    makeDb([{ title: `含${CODE}的标题`, content: "正文无感" }]);

    await handlePrefilterJob({ data: { itemId: 88 } as never });

    expect(capturedUsers.length).toBe(1);
    const payload = capturedUsers[0]!;
    expect(payload).not.toContain(CODE);
    expect(payload).toContain("[REDACTED:PROJECT_CODE:");
    expect(fakeQwen.chatJson).toHaveBeenCalledTimes(1);
  });
});
