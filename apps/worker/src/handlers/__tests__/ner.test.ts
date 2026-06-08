import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetDb, mockRunNer, mockWithScrubber, mockLoadEntityDictionary } = vi.hoisted(() => ({
  mockGetDb: vi.fn(),
  mockRunNer: vi.fn(),
  mockWithScrubber: vi.fn((client: unknown) => client),
  mockLoadEntityDictionary: vi.fn(),
}));

vi.mock("@fe-radar/db", () => ({
  getDb: mockGetDb,
  items: { id: "items.id", title: "items.title", content: "items.content" },
  itemEntities: { itemId: "ie.item_id", entityId: "ie.entity_id", span: "ie.span" },
  entities: { id: "entities.id", type: "entities.type", canonicalName: "entities.canonical_name" },
}));

vi.mock("@fe-radar/llm", () => ({ withScrubber: mockWithScrubber }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
}));
vi.mock("../../jobs/ner", () => ({ runNer: mockRunNer }));
vi.mock("../context", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  handlerContext: { qwen: { id: "qwen" } },
  loadEntityDictionary: mockLoadEntityDictionary,
}));

/**
 * Builds a chainable DB mock.
 * - itemSelectRows: rows for the first items.title/content select.
 * - entityLookupQueue: array of result arrays returned by each subsequent
 *   entities lookup select (FIFO), letting tests control resolve/no-resolve.
 */
function makeDb(itemSelectRows: unknown[], entityLookupQueue: unknown[][] = []) {
  let selectCall = 0;
  const insertValues = vi.fn(() => ({ onConflictDoNothing: vi.fn().mockResolvedValue(undefined) }));
  const db = {
    select: vi.fn(() => {
      const idx = selectCall++;
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue(idx === 0 ? itemSelectRows : (entityLookupQueue.shift() ?? [])),
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

import { handleNerJob } from "../ner";

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

    expect(mockRunNer).toHaveBeenCalledWith("远东电缆\n中标", expect.anything(), expect.anything());
    expect(db._insertValues).toHaveBeenCalledWith({ itemId: 100, entityId: 5, span: "远东电缆" });
  });

  it("boundary: entity with canonicalName but no matching row → no insert", async () => {
    const db = makeDb(
      [{ title: "标题", content: "正文" }],
      [[]], // entities lookup → not found
    );
    mockRunNer.mockResolvedValue({
      entities: [{ type: "company", text: "未知公司", canonicalName: "未知公司" }],
    });

    await handleNerJob({ data: { itemId: 101 } as never });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("boundary: entities without canonicalName are skipped entirely (no lookup, no insert)", async () => {
    const db = makeDb([{ title: "标题", content: "正文" }]);
    mockRunNer.mockResolvedValue({
      entities: [{ type: "region", text: "江苏" }], // no canonicalName
    });

    await handleNerJob({ data: { itemId: 102 } as never });
    expect(db.select).toHaveBeenCalledTimes(1); // only the item select, no entity lookup
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
