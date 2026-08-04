import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetDb, mockCreateRedisConnection, mockWithClusterCreateLock, mockPassesIndustryGate } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockCreateRedisConnection: vi.fn(() => ({ id: "redis", quit: vi.fn().mockResolvedValue(undefined) })),
  // default: lock simply runs the callback (lock acquired)
  mockWithClusterCreateLock: vi.fn(async (_redis: unknown, fn: () => Promise<unknown>) => fn()),
  mockPassesIndustryGate: vi.fn().mockResolvedValue(true),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  itemAnalysis: { itemId: "ia.item_id", embedding: "ia.embedding" },
  clusterItems: { clusterId: "ci.cluster_id", itemId: "ci.item_id", similarity: "ci.similarity" },
  clusters: { id: "clusters.id", centroid: "clusters.centroid", leadItemId: "clusters.lead_item_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  sql: Object.assign((s: TemplateStringsArray) => s.join(""), { raw: (s: string) => s }),
}));

vi.mock("../../queues", () => ({ createRedisConnection: mockCreateRedisConnection }));
vi.mock("../../jobs/cluster", () => ({ withClusterCreateLock: mockWithClusterCreateLock }));
vi.mock("../pipeline-gate", () => ({ passesIndustryGate: mockPassesIndustryGate }));
vi.mock("../context", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

/**
 * Builds a chainable DB mock.
 * - analysisRows: row[] for the itemAnalysis embedding select.
 * - candidateRows: row[] for the clusters candidate select.
 * - insertedClusterId: id returned by clusters insert .returning().
 */
function makeDb(opts: {
  analysisRows: unknown[];
  candidateRows?: unknown[];
  insertedClusterId?: number | null;
}) {
  let selectCall = 0;
  const clusterItemsOnConflict = vi.fn().mockResolvedValue(undefined);
  const clusterItemsValues = vi.fn(() => ({ onConflictDoNothing: clusterItemsOnConflict }));
  const clustersReturning = vi.fn().mockResolvedValue(
    opts.insertedClusterId === null ? [] : [{ id: opts.insertedClusterId ?? 77 }],
  );
  const clustersValues = vi.fn(() => ({ returning: clustersReturning }));

  const db = {
    select: vi.fn(() => {
      const idx = selectCall++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(idx === 0 ? opts.analysisRows : (opts.candidateRows ?? [])),
          })),
        })),
      };
    }),
    insert: vi.fn((table: { id?: string }) => {
      // clusters table has `id` column key; clusterItems does not in our mock
      if (table.id === "clusters.id") return { values: clustersValues };
      return { values: clusterItemsValues };
    }),
    _clusterItemsValues: clusterItemsValues,
    _clustersValues: clustersValues,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

import { cosineSimilarity, handleClusterJob } from "../cluster";

describe("cosineSimilarity", () => {
  it("identical vectors → 1", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("orthogonal vectors → 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("zero vector → 0 (denominator guard, no NaN)", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("mismatched length → compares over the shorter prefix", () => {
    // min length = 2; prefix [1,0] vs [1,0] is identical → 1
    expect(cosineSimilarity([1, 0, 99], [1, 0])).toBeCloseTo(1, 10);
  });
});

describe("handleClusterJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateRedisConnection.mockReturnValue({ id: "redis", quit: vi.fn().mockResolvedValue(undefined) });
    mockWithClusterCreateLock.mockImplementation(async (_redis: unknown, fn: () => Promise<unknown>) => fn());
    mockPassesIndustryGate.mockResolvedValue(true);
  });

  it("match-existing: similar candidate (sim>=0.85) → inserts into clusterItems, no new cluster", async () => {
    const db = makeDb({
      analysisRows: [{ itemId: 1, embedding: [1, 0, 0] }],
      candidateRows: [{ clusterId: 9, centroid: [1, 0, 0] }], // sim=1
    });

    await handleClusterJob({ data: { itemId: 1 } as never });

    expect(db._clusterItemsValues).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 9, itemId: 1, similarity: 1 }),
    );
    expect(mockWithClusterCreateLock).not.toHaveBeenCalled();
    expect(db._clustersValues).not.toHaveBeenCalled();
  });

  it("create-new: no candidate above threshold → acquires lock and creates a cluster + lead item", async () => {
    const db = makeDb({
      analysisRows: [{ itemId: 2, embedding: [1, 0, 0] }],
      candidateRows: [{ clusterId: 9, centroid: [0, 1, 0] }], // sim=0 < 0.85
      insertedClusterId: 55,
    });

    await handleClusterJob({ data: { itemId: 2 } as never });

    expect(mockWithClusterCreateLock).toHaveBeenCalledTimes(1);
    expect(db._clustersValues).toHaveBeenCalledWith(
      expect.objectContaining({ centroid: JSON.stringify([1, 0, 0]), leadItemId: 2 }),
    );
    expect(db._clusterItemsValues).toHaveBeenCalledWith({ clusterId: 55, itemId: 2, similarity: 1.0 });
  });

  it("boundary: no candidates at all → still creates a new cluster under lock", async () => {
    const db = makeDb({
      analysisRows: [{ itemId: 3, embedding: [0.2, 0.3] }],
      candidateRows: [],
      insertedClusterId: 88,
    });

    await handleClusterJob({ data: { itemId: 3 } as never });

    expect(mockWithClusterCreateLock).toHaveBeenCalledTimes(1);
    expect(db._clusterItemsValues).toHaveBeenCalledWith({ clusterId: 88, itemId: 3, similarity: 1.0 });
  });

  it("empty path: no analysis row → returns early, no lock, no inserts", async () => {
    const db = makeDb({ analysisRows: [] });
    await handleClusterJob({ data: { itemId: 404 } as never });

    expect(mockWithClusterCreateLock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("empty path: analysis row present but embedding null → returns early", async () => {
    const db = makeDb({ analysisRows: [{ itemId: 5, embedding: null }] });
    await handleClusterJob({ data: { itemId: 5 } as never });

    expect(mockWithClusterCreateLock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("hard gate: unrelated item skips clustering and Redis", async () => {
    const db = makeDb({ analysisRows: [] });
    mockPassesIndustryGate.mockResolvedValue(false);

    await handleClusterJob({ data: { itemId: 6 } as never });

    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(mockCreateRedisConnection).not.toHaveBeenCalled();
  });
});
