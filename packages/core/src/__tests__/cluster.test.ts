import { describe, expect, it } from "vitest";
import { cosineSimilarity, decideCluster, electLeadItem } from "../index";

describe("cluster decisions", () => {
  it("joins a cluster when cosine similarity is high", () => {
    const decision = decideCluster({
      itemId: 1,
      embedding: [1, 0],
      candidates: [{ clusterId: 10, centroid: [0.98, 0.02] }]
    });
    expect(decision.shouldCreate).toBe(false);
    expect(decision.clusterId).toBe(10);
  });

  it("creates a cluster when no candidate is similar enough", () => {
    expect(decideCluster({ itemId: 1, embedding: [1, 0], candidates: [{ clusterId: 10, centroid: [0, 1] }] }).shouldCreate).toBe(true);
  });

  it("elects lead item by tier, time, then length", () => {
    const lead = electLeadItem([
      { itemId: 1, tier: "T2", publishedAt: new Date("2026-01-02"), contentLength: 100 },
      { itemId: 2, tier: "T1", publishedAt: new Date("2026-01-03"), contentLength: 50 }
    ]);
    expect(lead?.itemId).toBe(2);
  });

  it("returns zero similarity for incompatible vectors", () => {
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});
