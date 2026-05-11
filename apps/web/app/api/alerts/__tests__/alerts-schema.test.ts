import { describe, expect, it } from "vitest";
import { alertQuerySchema } from "../../../../lib/api/alerts-schema";

describe("alerts api schema", () => {
  it("accepts type level source and cursor pagination", () => {
    expect(alertQuerySchema.parse({ type: "own", level: "L1", source: "12", limit: "20" })).toMatchObject({
      type: "own",
      level: "L1",
      source: 12,
      limit: 20
    });
  });

  it("rejects unknown alert type", () => {
    expect(alertQuerySchema.safeParse({ type: "other" }).success).toBe(false);
  });
});
