/**
 * A-12: 本文件对 withScrubber **不使用 identity mock**。
 * mockRunScorer 会真正调用传入的 client.chatJson({ user })，从而驱动真实
 * ScrubbedLlmClient；断言最终 payload 里原始代号子串不出现（覆盖任意字段泄漏）。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { withScrubber } from "@fe-radar/llm";
import type * as FeRadarLlm from "@fe-radar/llm";
import type * as FeRadarCore from "@fe-radar/core";

const {
  mockGetDb,
  mockRunScorer,
  mockComputeD3Market,
  mockListLatestFinancialsByMetric,
  mockPassesIndustryGate,
  mockLoadProjectCodes,
  fakeDeepSeek,
  capturedUsers,
} = vi.hoisted(() => {
  const capturedUsers: string[] = [];
  const fakeDeepSeek = {
    chatJson: vi.fn(async (req: { user: string }) => {
      capturedUsers.push(req.user);
      return { value: {}, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
    }),
    embedding: vi.fn(async () => {
      throw new Error("embedding not used in scorer");
    }),
  };
  return {
    mockGetDb: vi.fn(),
    mockRunScorer: vi.fn(),
    mockComputeD3Market: vi.fn(),
    mockListLatestFinancialsByMetric: vi.fn().mockResolvedValue([]),
    mockPassesIndustryGate: vi.fn().mockResolvedValue(true),
    mockLoadProjectCodes: vi.fn(),
    fakeDeepSeek,
    capturedUsers,
  };
});

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title", content: "items.content" },
  itemAnalysis: {
    itemId: "ia.item_id",
    d1Policy: "ia.d1",
    d3Market: "ia.d3",
    d4Tech: "ia.d4",
    d5Business: "ia.d5",
    summaryZh: "ia.summary",
    translationZh: "ia.translation",
    category: "ia.category",
  },
  itemEntities: { itemId: "ie.item_id" },
  entities: { id: "e.id", circle: "e.circle" },
  listLatestFinancialsByMetric: mockListLatestFinancialsByMetric,
}));

// partial mock：保留 scrubText 等真实导出，供真实 withScrubber 使用（A-12）
vi.mock("@fe-radar/core", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarCore>();
  return {
    ...actual,
    computeD3Market: mockComputeD3Market,
  };
});

// 不 mock withScrubber — 使用真实中间件
vi.mock("@fe-radar/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof FeRadarLlm>();
  return {
    ...actual,
    withScrubber: actual.withScrubber,
  };
});

vi.mock("drizzle-orm", () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }));
vi.mock("../../jobs/scorer", () => ({ runScorer: mockRunScorer }));
vi.mock("../pipeline-gate", () => ({ passesIndustryGate: mockPassesIndustryGate }));
vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { deepSeek: fakeDeepSeek },
  loadProjectCodes: mockLoadProjectCodes,
}));

function makeDb(selectRows: unknown[][]) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select: vi.fn(() => {
      const rows = selectRows.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
          innerJoin: vi.fn(() => ({ where: vi.fn().mockResolvedValue(rows) })),
        })),
      };
    }),
    update: vi.fn(() => ({ set: updateSet })),
    _updateSet: updateSet,
    _updateWhere: updateWhere,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

import { handleScorerJob } from "../scorer";

const fullScore = {
  d1Policy: 80,
  d3Market: 70,
  d4Tech: 60,
  d5Business: 50,
  summaryZh: "摘要",
  translationZh: "翻译",
  category: "政策与标准" as const,
};

/** 生产路径：handler 把 withScrubber(client) 传给 runScorer；mock 必须真正调 client.chatJson 才测到 scrubber。 */
function wireRunScorerThroughClient() {
  mockRunScorer.mockImplementation(async (text: string, client: { chatJson: (r: unknown) => Promise<unknown> }) => {
    await client.chatJson({
      system: "scoring",
      user: text,
      schemaName: "scoring",
      schema: { type: "object" },
    });
    return fullScore;
  });
}

describe("handleScorerJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedUsers.length = 0;
    mockListLatestFinancialsByMetric.mockResolvedValue([]);
    mockPassesIndustryGate.mockResolvedValue(true);
    mockLoadProjectCodes.mockResolvedValue(["内部代号A"]);
    wireRunScorerThroughClient();
  });

  it("normal path: persists all five-dimension scores returned by runScorer", async () => {
    const db = makeDb([
      [{ title: "标题", content: "正文" }],
      [],
    ]);

    await handleScorerJob({ data: { itemId: 11 } as never });

    expect(mockRunScorer).toHaveBeenCalledWith("标题\n正文", expect.anything());
    expect(db._updateSet).toHaveBeenCalledWith(fullScore);
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("boundary: null content builds text with trailing newline only", async () => {
    const db = makeDb([
      [{ title: "仅标题", content: null }],
      [],
    ]);

    await handleScorerJob({ data: { itemId: 12 } as never });

    expect(mockRunScorer).toHaveBeenCalledWith("仅标题\n", expect.anything());
    expect(db._updateSet).toHaveBeenCalledTimes(1);
  });

  it("empty path: item not found → no runScorer, no update", async () => {
    const db = makeDb([[]]);
    await handleScorerJob({ data: { itemId: 404 } as never });

    expect(mockRunScorer).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("hard gate: unrelated item skips scorer and all writes", async () => {
    const db = makeDb([]);
    mockPassesIndustryGate.mockResolvedValue(false);

    await handleScorerJob({ data: { itemId: 14 } as never });

    expect(mockRunScorer).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("error path: runScorer rejection propagates and update is skipped", async () => {
    const db = makeDb([
      [{ title: "标题", content: "正文" }],
    ]);
    mockRunScorer.mockRejectedValue(new Error("deepseek down"));

    await expect(handleScorerJob({ data: { itemId: 13 } as never })).rejects.toThrow("deepseek down");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("loads project codes per job (dict still loaded for scrubber context)", async () => {
    makeDb([
      [{ title: "标题", content: "正文" }],
      [],
      [{ title: "标题", content: "正文" }],
      [],
    ]);

    await handleScorerJob({ data: { itemId: 31 } as never });
    await handleScorerJob({ data: { itemId: 32 } as never });

    expect(mockLoadProjectCodes).toHaveBeenCalledTimes(2);
  });

  // A-12 核心：真实 withScrubber，断言最终 LLM payload 不含原始代号
  it("A-12: real withScrubber redacts project codes in final chatJson user payload", async () => {
    const CODE = "远东内部代号XYZ-SEC";
    mockLoadProjectCodes.mockResolvedValue([CODE]);
    makeDb([
      [{ title: `标题含${CODE}`, content: `正文也有${CODE}片段` }],
      [],
    ]);

    await handleScorerJob({ data: { itemId: 99 } as never });

    expect(capturedUsers.length).toBe(1);
    const payload = capturedUsers[0]!;
    // 原始代号子串不得出现在最终 payload（覆盖任意字段泄漏，不靠「函数被调用」）
    expect(payload).not.toContain(CODE);
    expect(payload).toContain("[REDACTED:PROJECT_CODE:");
    // 对照：withScrubber 本体可用
    expect(typeof withScrubber).toBe("function");
    // 内层 client 确实被调用（不是 mock identity 空转）
    expect(fakeDeepSeek.chatJson).toHaveBeenCalledTimes(1);
  });
});
