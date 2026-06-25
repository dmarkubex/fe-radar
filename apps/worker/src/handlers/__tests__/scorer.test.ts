import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetDb, mockRunScorer, mockWithScrubber, mockComputeD3Market, mockListLatestFinancialsByMetric } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunScorer: vi.fn(),
  mockWithScrubber: vi.fn((client: unknown) => client),
  mockComputeD3Market: vi.fn(),
  mockListLatestFinancialsByMetric: vi.fn().mockResolvedValue([]),
}));

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

vi.mock("@fe-radar/core", () => ({
  computeD3Market: mockComputeD3Market,
}));

vi.mock("@fe-radar/llm", () => ({ withScrubber: mockWithScrubber }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }));
vi.mock("../../jobs/scorer", () => ({ runScorer: mockRunScorer }));
vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { deepSeek: { id: "deepSeek" } },
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

describe("handleScorerJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
    mockListLatestFinancialsByMetric.mockResolvedValue([]);
  });

  it("normal path: persists all five-dimension scores returned by runScorer", async () => {
    const db = makeDb([
      [{ title: "标题", content: "正文" }],
      [],
    ]);
    mockRunScorer.mockResolvedValue(fullScore);

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
    mockRunScorer.mockResolvedValue(fullScore);

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

  it("error path: runScorer rejection propagates and update is skipped", async () => {
    const db = makeDb([
      [{ title: "标题", content: "正文" }],
    ]);
    mockRunScorer.mockRejectedValue(new Error("deepseek down"));

    await expect(handleScorerJob({ data: { itemId: 13 } as never })).rejects.toThrow("deepseek down");
    expect(db.update).not.toHaveBeenCalled();
  });
});
