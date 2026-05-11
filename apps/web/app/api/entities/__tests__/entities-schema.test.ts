import { describe, expect, it } from "vitest";
import { entityBodySchema } from "../../../../lib/api/entities-schema";

describe("entities api schema", () => {
  it("allows company circle and aliases", () => {
    expect(entityBodySchema.safeParse({
      type: "company",
      canonicalName: "远东控股",
      aliases: ["远东"],
      circle: "C1"
    }).success).toBe(true);
  });

  it("rejects circle for non-company entity", () => {
    expect(entityBodySchema.safeParse({
      type: "policy",
      canonicalName: "GB/T 12706",
      aliases: [],
      circle: "C2"
    }).success).toBe(false);
  });
});
