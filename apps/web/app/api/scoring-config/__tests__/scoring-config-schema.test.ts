import { describe, expect, it } from "vitest";
import { scoringConfigSchema } from "../../../../lib/api/scoring-config-schema";

const valid = {
  weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
  tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
  cCoef: { C1: 1.2, C2: 1, C3: 0.85 },
  thresholds: { "政策与标准": { C1: 55, C2: 60, C3: 65 } }
};

describe("scoring config schema", () => {
  it("accepts a complete config", () => {
    expect(scoringConfigSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects weights whose sum is not 1.00", () => {
    expect(scoringConfigSchema.safeParse({ ...valid, weights: { ...valid.weights, w5: 0.5 } }).success).toBe(false);
  });
});
