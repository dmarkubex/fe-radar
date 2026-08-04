import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCurateItem, mockGetDb, mockLoadScoringConfig, mockPassesIndustryGate } = vi.hoisted(() => ({
  mockCurateItem: vi.fn(),
  mockGetDb: vi.fn(),
  mockLoadScoringConfig: vi.fn(),
  mockPassesIndustryGate: vi.fn().mockResolvedValue(true),
}));

vi.mock("@fe-radar/core", () => ({
  curateItem: mockCurateItem,
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  entities: {
    id: "entities.id",
    type: "entities.type",
    canonicalName: "entities.canonical_name",
    circle: "entities.circle",
  },
  itemAnalysis: {
    itemId: "ia.item_id",
    d1Policy: "ia.d1_policy",
    d3Market: "ia.d3_market",
    d4Tech: "ia.d4_tech",
    d5Business: "ia.d5_business",
  },
  itemEntities: {
    itemId: "item_entities.item_id",
    entityId: "item_entities.entity_id",
  },
  items: {
    id: "items.id",
    sourceId: "items.source_id",
    title: "items.title",
    content: "items.content",
  },
  sources: {
    id: "sources.id",
    tier: "sources.tier",
    category: "sources.category",
    config: "sources.config",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}));

vi.mock("../pipeline-gate", () => ({ passesIndustryGate: mockPassesIndustryGate }));

vi.mock("../context", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  loadScoringConfig: mockLoadScoringConfig,
  loadOwnCompanyProfile: vi.fn().mockResolvedValue({
    names: new Set(["远东控股", "远东控股集团", "远东电缆", "远东智慧能源", "远东智慧能源股份", "远东股份", "远东智慧"]),
  }),
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

import { handleCuratorJob } from "../curator";

describe("handleCuratorJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadScoringConfig.mockResolvedValue({ thresholds: { quality: 60 } });
    mockPassesIndustryGate.mockResolvedValue(true);
    mockCurateItem.mockReturnValue({
      d2Chain: 95,
      qualityScore: 88,
      topCircle: "C1",
      isCurated: true,
      alertType: "own",
      alertLevel: "L1",
    });
  });

  it("passes source config risk keywords and category into curateItem", async () => {
    const db = makeDb([
      [{ sourceId: 7, title: "远东控股收到行政处罚告知书", content: "市场监管局罚款" }],
      [{
        tier: "T2",
        category: "风险检索",
        config: {
          entityKeywords: [" 远东控股 ", "", "远东电缆"],
          riskKeywords: ["行政处罚", " 罚款 "],
        },
      }],
      [{ d1Policy: 10, d3Market: 20, d4Tech: 30, d5Business: 40, category: "经营风险" }],
      [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
    ]);

    await handleCuratorJob({ data: { itemId: 42, correlationId: "c-42" } as never });

    expect(mockCurateItem).toHaveBeenCalledWith(expect.objectContaining({
      title: "远东控股收到行政处罚告知书",
      content: "市场监管局罚款",
      sourceCategory: "风险检索",
      riskEntityKeywords: ["远东控股", "远东电缆"],
      riskKeywords: ["行政处罚", "罚款"],
      entities: [{ id: 1, type: "company", canonicalName: "远东控股", circle: "C1" }],
    }));
    expect(db._updateSet).toHaveBeenCalledWith(expect.objectContaining({
      d2Chain: 95,
      qualityScore: 88,
      alertType: "own",
      alertLevel: "L1",
    }));
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("hard gate: unrelated item clears stale presentation state without curating", async () => {
    const db = makeDb([]);
    mockPassesIndustryGate.mockResolvedValue(false);

    await handleCuratorJob({ data: { itemId: 43, correlationId: "c-43" } as never });

    expect(mockCurateItem).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db._updateSet).toHaveBeenCalledWith({
      isCurated: false,
      alertType: null,
      alertLevel: null,
    });
  });
});
