import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchContext } from "../../types";
import type { DataproSourceConfig } from "../types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDataproSearch,
  mockGetDb,
  mockUpsertEntityFinancials,
  mockDbSelect,
  mockDbFrom,
  mockDbWhere,
} = vi.hoisted(() => {
  const mockDbWhere = vi.fn();
  const mockDbFrom = vi.fn();
  const mockDbSelect = vi.fn();
  const mockDataproSearch = vi.fn();
  const mockGetDb = vi.fn();
  const mockUpsertEntityFinancials = vi.fn();
  return {
    mockDataproSearch,
    mockGetDb,
    mockUpsertEntityFinancials,
    mockDbSelect,
    mockDbFrom,
    mockDbWhere,
  };
});

vi.mock("../client", () => ({
  dataproSearch: mockDataproSearch,
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  upsertEntityFinancials: mockUpsertEntityFinancials,
  entities: { id: "id" },
}));

import { dataproAdapter } from "../adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctx: FetchContext = { sourceName: "datapro-risk" };

const riskConfig: DataproSourceConfig = {
  type: "datapro",
  dataType: "risk",
  entities: [{ name: "远东电缆", stockCode: "600869" }],
};

const financialConfig: DataproSourceConfig = {
  type: "datapro",
  dataType: "financial",
  entities: [{ name: "远东电缆", stockCode: "600869" }],
};

function setupMockDb(entityRows: Array<{ id: number; stockCode: string }>): void {
  mockDbWhere.mockResolvedValue(entityRows);
  mockDbFrom.mockReturnValue({ where: mockDbWhere });
  mockDbSelect.mockReturnValue({ from: mockDbFrom });
  mockGetDb.mockReturnValue({
    select: mockDbSelect,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("datapro adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertEntityFinancials.mockResolvedValue(1);
  });

  it("has name 'datapro'", () => {
    expect(dataproAdapter.name).toBe("datapro");
  });

  it("maps risk results to StandardItem[]", async () => {
    mockDataproSearch.mockResolvedValueOnce([
      {
        table: {
          公司名称: "远东电缆",
          案号: "(2026)沪01民终123号",
          风险类型: "司法诉讼",
          立案日期: "2026-06-20",
          执行法院: "上海一中院",
        },
      },
    ]);

    const items = await dataproAdapter.fetch(riskConfig, ctx);

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("远东电缆 - 司法诉讼 - (2026)沪01民终123号");
    expect(items[0]!.url).toContain("datapro://risk/600869/");
    expect(items[0]!.content).toContain("案号: (2026)沪01民终123号");
    expect(items[0]!.content).toContain("执行法院: 上海一中院");
    expect(items[0]!.publishedAt).toEqual(new Date("2026-06-20"));
  });

  it("upserts financials and returns [] for financial dataType", async () => {
    setupMockDb([{ id: 1, stockCode: "600869" }]);

    mockDataproSearch.mockResolvedValueOnce([
      {
        table: {
          公司名称: "远东电缆",
          ROE: "15.5%",
          净利润: "10亿",
          营收: "100亿",
          营收增速: "20%",
          净利润增速: "25%",
          报告期: "2026Q1",
        },
      },
    ]);

    const items = await dataproAdapter.fetch(financialConfig, ctx);

    expect(items).toEqual([]);
    expect(mockUpsertEntityFinancials).toHaveBeenCalledOnce();
    const [, records] = mockUpsertEntityFinancials.mock.calls[0] as [
      unknown,
      Array<{ entityId: number; metric: string; value: number | null; period: string }>,
    ];
    expect(records).toHaveLength(5);
    const roe = records.find((r) => r.metric === "roe");
    expect(roe).toBeDefined();
    expect(roe!.entityId).toBe(1);
    expect(roe!.value).toBe(15.5);
    expect(roe!.period).toBe("2026Q1");
  });

  it("throws FETCH_ALL_QUERIES_FAILED when all batches return empty results", async () => {
    mockDataproSearch.mockResolvedValue([]);

    await expect(dataproAdapter.fetch(riskConfig, ctx)).rejects.toMatchObject({
      code: "FETCH_ALL_QUERIES_FAILED",
      message: "dataPro 查询返回空结果",
    });
  });

  it("throws FETCH_ALL_QUERIES_FAILED when all batches fail", async () => {
    mockDataproSearch.mockRejectedValue(new Error("network down"));

    await expect(dataproAdapter.fetch(riskConfig, ctx)).rejects.toMatchObject({
      code: "FETCH_ALL_QUERIES_FAILED",
      message: "所有 dataPro 批次查询均失败",
    });
  });

  it("continues on single batch failure and keeps successful results", async () => {
    const config: DataproSourceConfig = {
      type: "datapro",
      dataType: "risk",
      entities: [
        { name: "公司A", stockCode: "000001" },
        { name: "公司B", stockCode: "000002" },
      ],
      maxStocksPerQuery: 1,
    };

    mockDataproSearch
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce([
        {
          table: {
            公司名称: "公司B",
            案号: "(2026)京01执456号",
            风险类型: "行政处罚",
            立案日期: "2026-06-21",
          },
        },
      ]);

    const items = await dataproAdapter.fetch(config, ctx);

    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain("公司B");
    expect(mockDataproSearch).toHaveBeenCalledTimes(2);
  });

  it("skips query when scrubber level is block (PII threshold)", async () => {
    // 3 phone numbers → piiCount=3 → level='block'
    const piiConfig: DataproSourceConfig = {
      type: "datapro",
      dataType: "risk",
      entities: [
        { name: "13812345678 13912345678 13712345678", stockCode: "600869" },
      ],
    };

    await expect(dataproAdapter.fetch(piiConfig, ctx)).rejects.toMatchObject({
      code: "FETCH_ALL_QUERIES_FAILED",
    });
    expect(mockDataproSearch).not.toHaveBeenCalled();
  });
});
