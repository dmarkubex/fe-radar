import { describe, expect, it, vi } from "vitest";

vi.mock("@fe-radar/db", () => ({
  itemAnalysis: {
    itemId: "ia.item_id",
    isIndustryRelated: "ia.is_industry_related",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ a, b })),
}));

import { passesIndustryGate } from "../pipeline-gate";

function makeDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue(rows),
        })),
      })),
    })),
  };
}

describe("passesIndustryGate", () => {
  it.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])("isIndustryRelated=%s passes=%s", async (value, expected) => {
    const db = makeDb(value === undefined ? [] : [{ isIndustryRelated: value }]);

    await expect(passesIndustryGate(db as never, 42)).resolves.toBe(expected);
  });
});
