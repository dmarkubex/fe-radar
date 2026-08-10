import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted() runs before module resolution
// ---------------------------------------------------------------------------

const { mockGetDb, mockRunPrefilter, mockWithScrubber, mockLoadProjectCodes } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunPrefilter: vi.fn(),
  mockWithScrubber: vi.fn((client: unknown) => client),
  mockLoadProjectCodes: vi.fn(),
}));

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

describe("handlePrefilterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
    mockLoadProjectCodes.mockResolvedValue(["内部代号A"]);
  });

  it("normal path: writes isIndustryRelated=true when runPrefilter returns true", async () => {
    const db = makeDb([{ title: "电网投资", content: "正文" }]);
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: true, reason: "电力" });

    await handlePrefilterJob({ data: { itemId: 42 } as never });

    expect(mockRunPrefilter).toHaveBeenCalledTimes(1);
    expect(db._updateSet).toHaveBeenCalledWith({ isIndustryRelated: true });
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("boundary: 'unknown' result clears presentation state and remains pending", async () => {
    const db = makeDb([{ title: "无关新闻", content: null }]);
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: "unknown", reason: "x" });

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
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: false, reason: "not industry" });

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

  // T-SEC-09: 项目代号字典必须按 job 即时加载（不再用 bootstrap 启动快照），
  // admin 新增代号后最迟一个缓存周期生效，无需重启 worker。
  it("loads project codes per job and injects them into withScrubber context", async () => {
    makeDb([{ title: "电网投资", content: "正文" }]);
    mockRunPrefilter.mockResolvedValue({ isIndustryRelated: true, reason: "电力" });

    await handlePrefilterJob({ data: { itemId: 1 } as never });
    await handlePrefilterJob({ data: { itemId: 2 } as never });

    expect(mockLoadProjectCodes).toHaveBeenCalledTimes(2);
    expect(mockWithScrubber).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectCodes: ["内部代号A"] }),
    );
  });
});
