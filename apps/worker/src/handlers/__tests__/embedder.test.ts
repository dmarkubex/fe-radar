import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetDb, mockRunEmbedder, mockWithScrubber, mockPassesIndustryGate, mockLoadProjectCodes } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunEmbedder: vi.fn(),
  mockWithScrubber: vi.fn((client: unknown) => client),
  mockPassesIndustryGate: vi.fn().mockResolvedValue(true),
  mockLoadProjectCodes: vi.fn(),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title" },
  itemAnalysis: { itemId: "ia.item_id", summaryZh: "ia.summary", embedding: "ia.embedding" },
}));

vi.mock("@fe-radar/llm", () => ({ withScrubber: mockWithScrubber }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ a, b })) }));
vi.mock("../../jobs/embedder", () => ({ runEmbedder: mockRunEmbedder }));
vi.mock("../pipeline-gate", () => ({ passesIndustryGate: mockPassesIndustryGate }));
vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: { id: "qwen" } },
  // loadProjectCodes 仍可能被其他模块引用；embedder 已不再调用
  loadProjectCodes: mockLoadProjectCodes,
}));

function makeDb(selectRows: unknown[]) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(selectRows) })),
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

import { handleEmbedderJob } from "../embedder";

describe("handleEmbedderJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
    mockPassesIndustryGate.mockResolvedValue(true);
    mockLoadProjectCodes.mockResolvedValue(["内部代号A"]);
  });

  it("normal path: persists JSON-serialized embedding when runEmbedder returns a vector", async () => {
    const db = makeDb([{ title: "标题", summaryZh: "摘要" }]);
    const vec = Array.from({ length: 1024 }, () => 0.1);
    mockRunEmbedder.mockResolvedValue(vec);

    await handleEmbedderJob({ data: { itemId: 21 } as never });

    expect(mockRunEmbedder).toHaveBeenCalledWith("标题", "摘要", expect.anything());
    expect(db._updateSet).toHaveBeenCalledWith({ embedding: JSON.stringify(vec) });
    expect(db._updateWhere).toHaveBeenCalledTimes(1);
  });

  it("boundary: null summaryZh falls back to title as embedding source", async () => {
    makeDb([{ title: "仅标题", summaryZh: null }]);
    mockRunEmbedder.mockResolvedValue([0.5]);

    await handleEmbedderJob({ data: { itemId: 22 } as never });
    expect(mockRunEmbedder).toHaveBeenCalledWith("仅标题", "仅标题", expect.anything());
  });

  it("error/empty path: runEmbedder returns null (scrubber block) → no DB update", async () => {
    const db = makeDb([{ title: "标题", summaryZh: "摘要" }]);
    mockRunEmbedder.mockResolvedValue(null);

    await handleEmbedderJob({ data: { itemId: 23 } as never });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("empty path: item/analysis join returns no row → runEmbedder not called", async () => {
    const db = makeDb([]);
    await handleEmbedderJob({ data: { itemId: 404 } as never });

    expect(mockRunEmbedder).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("hard gate: unrelated item skips embedding and all writes", async () => {
    const db = makeDb([]);
    mockPassesIndustryGate.mockResolvedValue(false);

    await handleEmbedderJob({ data: { itemId: 24 } as never });

    expect(mockRunEmbedder).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // A-12 / embedder 附带：本地 Qwen 不注入 projectCodes（防 embedding 漂移）。
  it("withScrubber is called WITHOUT projectCodes (local Qwen; no code redaction on embed)", async () => {
    makeDb([{ title: "标题", summaryZh: "摘要" }]);
    mockRunEmbedder.mockResolvedValue([0.5]);

    await handleEmbedderJob({ data: { itemId: 25 } as never });

    expect(mockLoadProjectCodes).not.toHaveBeenCalled();
    expect(mockWithScrubber).toHaveBeenCalledTimes(1);
    // 仅 client 一参；不得注入 projectCodes 上下文
    expect(mockWithScrubber).toHaveBeenCalledWith(expect.anything());
    const call = mockWithScrubber.mock.calls[0] as unknown[] | undefined;
    expect(call).toBeDefined();
    expect(call!.length).toBe(1);
  });
});
