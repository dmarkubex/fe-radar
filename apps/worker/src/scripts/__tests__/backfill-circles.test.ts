import { describe, expect, it, vi } from "vitest";

import { curateItem, type ScoringConfig } from "@fe-radar/core";

import { EntityDictionary } from "../../lib/entities-dict";
import {
  applyBackfillPlan,
  findCircleLinks,
  parseBackfillArgs,
  planAnalysisUpdate,
  selectNewLinks,
  type BackfillWriter,
  type CircleLink
} from "../backfill-circles";

const config: ScoringConfig = {
  weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
  tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
  cCoef: { C1: 1.2, C2: 1, C3: 0.85 }
};

const farEastLink: CircleLink = {
  itemId: 1,
  entityId: 10,
  span: "远东控股",
  entity: {
    id: 10,
    type: "company",
    canonicalName: "远东控股集团",
    circle: "C1"
  }
};

const stateGridEntity = {
  id: 11,
  type: "company",
  canonicalName: "国家电网",
  circle: "C1" as const
};

describe("backfill circles", () => {
  it("does not add a broad two-character Far East substring fallback", () => {
    const dictionary = new EntityDictionary([
      {
        id: 10,
        type: "company",
        canonicalName: "远东控股集团",
        aliases: ["远东控股"],
        circle: "C1"
      }
    ]);

    expect(
      findCircleLinks(
        [{ id: 1, title: "上海远东仪表厂发布新品", content: null }],
        dictionary
      )
    ).toEqual([]);
  });

  it("plans each item/entity link once and is idempotent after it exists", () => {
    expect(selectNewLinks([farEastLink, farEastLink], new Set())).toEqual([
      farEastLink
    ]);
    expect(selectNewLinks([farEastLink], new Set(["1:10"]))).toEqual([]);
  });

  it("matches curateItem for the same entities, atoms, tier, and config", () => {
    const analysis = {
      itemId: 1,
      tier: "T1" as const,
      currentTopCircle: "C3",
      currentQualityScore: 45,
      d1Policy: 50,
      d2Chain: 0,
      d3Market: 50,
      d4Tech: 50,
      d5Business: 50
    };
    const entityHits = [farEastLink.entity, stateGridEntity];
    const update = planAnalysisUpdate(analysis, entityHits, config);
    const online = curateItem({
      atoms: {
        d1Policy: analysis.d1Policy,
        d3Market: analysis.d3Market,
        d4Tech: analysis.d4Tech,
        d5Business: analysis.d5Business
      },
      source: { tier: analysis.tier },
      entities: entityHits,
      config,
      category: "公司与资本"
    });

    expect(update).toEqual({
      itemId: 1,
      topCircle: "C1",
      d2Chain: 95,
      qualityScore: 73.5
    });
    expect(update?.d2Chain).toBe(online.d2Chain);
    expect(update?.qualityScore).toBe(online.qualityScore);
    expect(update?.topCircle).toBe(online.topCircle);
    expect(Object.keys(update ?? {}).sort()).toEqual([
      "d2Chain",
      "itemId",
      "qualityScore",
      "topCircle"
    ]);
  });

  it("recomputes no-entity items with the design baseline D2=20", () => {
    expect(
      planAnalysisUpdate(
        {
          itemId: 2,
          tier: "T1",
          currentTopCircle: null,
          currentQualityScore: null,
          d1Policy: 0,
          d2Chain: 0,
          d3Market: 0,
          d4Tech: 0,
          d5Business: 0
        },
        [],
        config
      )
    ).toEqual({
      itemId: 2,
      topCircle: "C3",
      d2Chain: 20,
      qualityScore: 4.25
    });
  });

  it("requires a fixed window and defaults the CLI to dry-run", () => {
    expect(
      parseBackfillArgs([
        "--run-id",
        "canary-7d",
        "--from",
        "2026-05-01T00:00:00+08:00",
        "--until",
        "2026-05-08T00:00:00+08:00"
      ])
    ).toMatchObject({ runId: "canary-7d", dryRun: true });
    expect(
      parseBackfillArgs([
        "--run-id",
        "canary-7d",
        "--from",
        "2026-05-01T00:00:00+08:00",
        "--until",
        "2026-05-08T00:00:00+08:00",
        "--apply"
      ])
    ).toMatchObject({ dryRun: false });
    expect(() => parseBackfillArgs([])).toThrow("固定窗口");
  });

  it("does not call either writer in dry-run mode", async () => {
    const writer: BackfillWriter = {
      insertLinks: vi.fn().mockResolvedValue(1),
      updateAnalyses: vi.fn().mockResolvedValue(undefined)
    };

    await expect(
      applyBackfillPlan(
        {
          links: [farEastLink],
          updates: [
            {
              itemId: 1,
              topCircle: "C1",
              d2Chain: 92,
              qualityScore: 72.6
            }
          ]
        },
        true,
        writer
      )
    ).resolves.toEqual({ linksCreated: 0 });
    expect(writer.insertLinks).not.toHaveBeenCalled();
    expect(writer.updateAnalyses).not.toHaveBeenCalled();
  });
});
