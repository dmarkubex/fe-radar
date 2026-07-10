import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  mockGetDb,
  mockRunNer,
  mockWithScrubber,
  mockLoadEntityDictionary,
  mockAdmitWebSearch,
  mockCreateRedisConnection,
  mockCreateWebsearchQueue,
  mockQueueAdd,
  mockQueueClose,
  mockRedis,
  mockLogger,
} = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
  const mockQueueClose = vi.fn().mockResolvedValue(undefined);
  const mockRedis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  return {
    mockGetDb: vi.fn(),
    mockRunNer: vi.fn(),
    mockWithScrubber: vi.fn((client: unknown) => client),
    mockLoadEntityDictionary: vi.fn(),
    mockAdmitWebSearch: vi.fn().mockResolvedValue({ state: "admitted" }),
    mockCreateRedisConnection: vi.fn(() => mockRedis),
    mockCreateWebsearchQueue: vi.fn(() => ({ add: mockQueueAdd, close: mockQueueClose })),
    mockQueueAdd,
    mockQueueClose,
    mockRedis,
    mockLogger,
  };
});

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title", content: "items.content" },
  itemEntities: { itemId: "ie.item_id", entityId: "ie.entity_id", span: "ie.span" },
  entities: {
    id: "entities.id",
    type: "entities.type",
    canonicalName: "entities.canonical_name",
    aliases: "entities.aliases",
    circle: "entities.circle",
    weight: "entities.weight",
  },
}));

vi.mock("@fe-radar/llm", () => ({ withScrubber: mockWithScrubber }));
vi.mock("@fe-radar/core", () => ({ admitWebSearch: mockAdmitWebSearch }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  arrayContains: vi.fn((a: unknown, b: unknown) => ({ arrayContains: [a, b] })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ sql: strings, values }),
    { raw: (s: string) => s },
  ),
}));
vi.mock("../../jobs/ner", () => ({ runNer: mockRunNer }));
vi.mock("../context", () => ({
  logger: mockLogger,
  handlerContext: { qwen: { id: "qwen" }, deepSeek: { id: "deepseek" } },
  loadEntityDictionary: mockLoadEntityDictionary,
}));
vi.mock("../../queues", () => ({
  createRedisConnection: mockCreateRedisConnection,
  createWebsearchQueue: mockCreateWebsearchQueue,
}));

/**
 * Builds a chainable DB mock.
 * - itemSelectRows: rows for the first items.title/content select.
 * - entityLookupQueue: FIFO results for each entities lookup (canonical and/or alias).
 *   Both `.limit()` and `.orderBy().limit()` pull from the same queue.
 * - c1c2Hits: rows returned by the T-ARK-17 C1/C2 websearch probe
 *   (item_entities ⨝ entities). Defaults to [] so legacy tests trigger no
 *   websearch side-effect.
 */
function makeDb(itemSelectRows: unknown[], entityLookupQueue: unknown[][] = [], c1c2Hits: unknown[] = []) {
  let selectCall = 0;
  const insertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }));
  const db = {
    select: vi.fn(() => {
      const idx = selectCall++;
      const resolveRows = async () => {
        if (idx === 0) return itemSelectRows;
        return entityLookupQueue.shift() ?? [];
      };
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockImplementation(resolveRows),
            // alias path: .orderBy(...) is awaited directly (no limit)
            orderBy: vi.fn().mockImplementation(resolveRows),
          })),
          innerJoin: vi.fn(() => ({
            where: vi.fn().mockResolvedValue(c1c2Hits),
          })),
        })),
      };
    }),
    insert: vi.fn(() => ({ values: insertValues })),
    _insertValues: insertValues,
  };
  mockGetDb.mockReturnValue(db);
  return db;
}

import { handleNerJob, pickBestAliasHit } from "../ner";

describe("pickBestAliasHit (T-REV-04 disambiguation)", () => {
  it("prefers C1 over C2 even when C2 has higher weight", () => {
    const best = pickBestAliasHit([
      { id: 2, circle: "C2", weight: 9.0 },
      { id: 1, circle: "C1", weight: 0.1 },
    ]);
    expect(best?.id).toBe(1);
  });

  it("within same circle prefers higher weight", () => {
    const best = pickBestAliasHit([
      { id: 10, circle: "C1", weight: 0.5 },
      { id: 11, circle: "C1", weight: 1.2 },
    ]);
    expect(best?.id).toBe(11);
  });

  it("ranks C1 > C2 > C3 > null", () => {
    const best = pickBestAliasHit([
      { id: 3, circle: null, weight: 99 },
      { id: 2, circle: "C3", weight: 5 },
      { id: 1, circle: "C2", weight: 1 },
    ]);
    expect(best?.id).toBe(1);
  });

  it("returns null for empty hits", () => {
    expect(pickBestAliasHit([])).toBeNull();
  });
});

describe("handleNerJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
    mockLoadEntityDictionary.mockResolvedValue({ match: () => [] });
  });

  it("normal path: links entity when canonicalName resolves to an existing entity row", async () => {
    const db = makeDb(
      [{ title: "远东电缆", content: "中标" }],
      [[{ id: 5 }]], // entities lookup → found
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "远东电缆", canonicalName: "远东电缆" }],
    });

    await handleNerJob({ data: { itemId: 100 } as never });

    expect(mockRunNer).toHaveBeenCalledWith("远东电缆\n中标", expect.anything(), expect.anything(), expect.anything());
    expect(db._insertValues).toHaveBeenCalledWith({ itemId: 100, entityId: 5, span: "远东电缆" });
  });

  it("boundary: entity with canonicalName but no matching row → no insert", async () => {
    const db = makeDb(
      [{ title: "标题", content: "正文" }],
      [[], []], // canonical miss → alias miss
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "未知公司", canonicalName: "未知公司" }],
    });

    await handleNerJob({ data: { itemId: 101 } as never });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("alias fallback: canonical miss + alias hit → insert + info log", async () => {
    const db = makeDb(
      [{ title: "远东股份中标", content: "正文" }],
      [
        [], // canonical miss
        [{ id: 12, circle: "C1", weight: 1.0 }], // alias hit
      ],
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "远东股份", canonicalName: "远东股份" }],
    });

    await handleNerJob({ data: { itemId: 200 } as never });

    expect(db._insertValues).toHaveBeenCalledWith({ itemId: 200, entityId: 12, span: "远东股份" });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 200,
        extractedName: "远东股份",
        entityId: 12,
        circle: "C1",
        match: "alias_fallback",
      }),
      "NER entity resolved via alias fallback",
    );
  });

  it("alias disambiguation: unsorted multi-hit rows → picks C1 over higher-weight C2", async () => {
    // Mock returns unsorted multi-row set (as a raw SELECT without relying on SQL ORDER BY).
    // pickBestAliasHit must still choose C1 (id=1) over C2 with higher weight (id=2).
    const db = makeDb(
      [{ title: "远东", content: "正文" }],
      [
        [], // canonical miss
        [
          { id: 2, circle: "C2", weight: 9.0 },
          { id: 1, circle: "C1", weight: 0.1 },
        ],
      ],
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "远东", canonicalName: "远东" }],
    });

    await handleNerJob({ data: { itemId: 201 } as never });

    expect(db._insertValues).toHaveBeenCalledWith({ itemId: 201, entityId: 1, span: "远东" });
  });

  it("alias miss after canonical miss → no insert (same as pre-fix)", async () => {
    const db = makeDb(
      [{ title: "标题", content: "正文" }],
      [[], []],
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "完全陌生", canonicalName: "完全陌生" }],
    });

    await handleNerJob({ data: { itemId: 202 } as never });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("boundary: entities without canonicalName are skipped entirely (no per-entity lookup, no insert)", async () => {
    const db = makeDb([{ title: "标题", content: "正文" }]);
    mockRunNer.mockResolvedValue({
      entities: [{ type: "region", text: "江苏" }], // no canonicalName
    });

    await handleNerJob({ data: { itemId: 102 } as never });
    // item select (idx 0) + C1/C2 websearch probe (idx 1, innerJoin path);
    // NO per-entity lookup select was issued by the NER entity loop.
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("empty path: item not found → returns early, runNer not called", async () => {
    const db = makeDb([]);
    await handleNerJob({ data: { itemId: 404 } as never });

    expect(mockRunNer).not.toHaveBeenCalled();
    expect(mockLoadEntityDictionary).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("handleNerJob — websearch trigger (T-ARK-17)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWithScrubber.mockImplementation((client: unknown) => client);
    mockLoadEntityDictionary.mockResolvedValue({ match: () => [] });
    mockRunNer.mockResolvedValue({ entities: [] });
    mockAdmitWebSearch.mockResolvedValue({ state: "admitted" });
    mockCreateRedisConnection.mockImplementation(() => mockRedis);
    mockCreateWebsearchQueue.mockImplementation(() => ({ add: mockQueueAdd, close: mockQueueClose }));
    mockRedis.get.mockResolvedValue(null);
    mockRedis.set.mockResolvedValue("OK");
    mockQueueAdd.mockResolvedValue(undefined);
    mockQueueClose.mockResolvedValue(undefined);
  });

  it("enqueues websearch for C1/C2 entities hit (admitted, no cooldown)", async () => {
    makeDb(
      [{ title: "远东电缆", content: "中标" }],
      [],
      [{ entityId: 5, canonicalName: "远东电缆", circle: "C1" }],
    );

    await handleNerJob({ data: { itemId: 100, correlationId: "corr-1" } as never });

    expect(mockCreateRedisConnection).toHaveBeenCalledTimes(1);
    // monthKey is Asia/Shanghai YYYY-MM
    expect(mockAdmitWebSearch).toHaveBeenCalledWith(
      expect.stringMatching(/^\d{4}-\d{2}$/),
      mockRedis,
    );
    expect(mockQueueAdd).toHaveBeenCalledWith("websearch", {
      entityId: 5,
      entityName: "远东电缆",
      itemId: 100,
      correlationId: "corr-1",
    });
    // cooldown stamped after enqueue, TTL = 24h
    expect(mockRedis.set).toHaveBeenCalledWith("websearch:entity:5:24h", "1", "EX", 86400);
    // queue + connection always released
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });

  it("skips entities within the 24h cooldown before consuming a quota incr", async () => {
    makeDb(
      [{ title: "远东电缆", content: "中标" }],
      [],
      [{ entityId: 5, canonicalName: "远东电缆", circle: "C1" }],
    );
    mockRedis.get.mockResolvedValue("1"); // already cooled

    await handleNerJob({ data: { itemId: 100 } as never });

    expect(mockAdmitWebSearch).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it("discards entity when monthly quota exhausted (warn, no enqueue, no cooldown stamp)", async () => {
    makeDb(
      [{ title: "远东电缆", content: "中标" }],
      [],
      [{ entityId: 5, canonicalName: "远东电缆", circle: "C2" }],
    );
    mockAdmitWebSearch.mockResolvedValue({ state: "pending_over_quota" });

    await handleNerJob({ data: { itemId: 100 } as never });

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 5, entityName: "远东电缆" }),
      "websearch monthly quota exhausted, discarding (no retry)",
    );
    // queue + connection still released
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
  });

  it("processes multiple entities: skips cooled, enqueues the rest", async () => {
    makeDb(
      [{ title: "标题", content: "正文" }],
      [],
      [
        { entityId: 1, canonicalName: "远东电缆", circle: "C1" },
        { entityId: 2, canonicalName: "国家电网", circle: "C2" },
      ],
    );
    // entity 1 cooled, entity 2 fresh
    mockRedis.get
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce(null);

    await handleNerJob({ data: { itemId: 100, correlationId: "c" } as never });

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd).toHaveBeenCalledWith("websearch", {
      entityId: 2,
      entityName: "国家电网",
      itemId: 100,
      correlationId: "c",
    });
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    expect(mockRedis.set).toHaveBeenCalledWith("websearch:entity:2:24h", "1", "EX", 86400);
  });

  it("does not create a Redis connection when no C1/C2 entities are hit", async () => {
    makeDb([{ title: "标题", content: "正文" }], [], []);

    await handleNerJob({ data: { itemId: 100 } as never });

    expect(mockCreateRedisConnection).not.toHaveBeenCalled();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("does not block the NER main flow when websearch trigger fails (Redis down)", async () => {
    makeDb(
      [{ title: "远东电缆", content: "中标" }],
      [],
      [{ entityId: 5, canonicalName: "远东电缆", circle: "C1" }],
    );
    mockCreateRedisConnection.mockImplementationOnce(() => {
      throw new Error("ECONNREFUSED");
    });

    await handleNerJob({ data: { itemId: 100 } as never });

    // NER main flow completed before the websearch side-effect
    expect(mockRunNer).toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 100 }),
      "websearch trigger failed, NER continues",
    );
  });
});
