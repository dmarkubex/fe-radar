import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before module resolution
// ---------------------------------------------------------------------------

const { mockGetDb, mockRunPrefilter, mockWithScrubber } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunPrefilter: vi.fn(),
  mockWithScrubber: vi.fn((client: unknown) => client),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title", content: "items.content" },
  itemAnalysis: { itemId: "ia.item_id", isIndustryRelated: "ia.is_industry_related" },
}));

vi.mock("@fe-radar/llm", () => ({
  withScrubber: mockWithScrubber,
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}));

vi.mock("../../jobs/prefilter", () => ({
  runPrefilter: mockRunPrefilter,
}));

vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: { id: "qwen" }, deepSeek: { id: "deepSeek" } },
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

describe("handlePrefilterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
  });

  it("normal path: writes isIndustryRelated=true when runPrefilter returns true", async () => {
    const db = makeDb([{ title: "电网投资", content: "正文" }]);
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: true, reason: "电力" });

    await handlePrefilterJob({ data: { itemId: 42 } as never });

    expect(mockRunPrefilter).toHaveBeenCalledTimes(1);
    expect(db._updateSet).toHaveBeenCalledWith({ isIndustryRelated: true });
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("boundary: non-true result (\"unknown\") is coerced to isIndustryRelated=false", async () => {
    const db = makeDb([{ title: "无关新闻", content: null }]);
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: "unknown", reason: "x" });

    await handlePrefilterJob({ data: { itemId: 7 } as never });

    // content null → falls back to title; result not strictly true → false
    expect(mockRunPrefilter).toHaveBeenCalledWith(
      { title: "无关新闻", content: "无关新闻" },
      expect.anything(),
      expect.anything(),
    );
    expect(db._updateSet).toHaveBeenCalledWith({ isIndustryRelated: false });
  });

  it("empty path: item not found → warns and does not call runPrefilter or update", async () => {
    const db = makeDb([]);
    await handlePrefilterJob({ data: { itemId: 999 } as never });

    expect(mockRunPrefilter).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
