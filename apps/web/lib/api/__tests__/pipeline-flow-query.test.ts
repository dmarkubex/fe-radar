import { describe, expect, it } from "vitest";

import {
  THRESHOLD_GREEN,
  buildPipelineFlowPayload,
  type PipelineFlowItemMarkerRow,
  type PipelineFlowSourceMarkerRow
} from "../pipeline-flow-query";

const recent = new Date("2026-06-17T04:00:00.000Z");

function source(id: number, overrides: Partial<PipelineFlowSourceMarkerRow> = {}): PipelineFlowSourceMarkerRow {
  return {
    id,
    name: `source-${id}`,
    tier: "T1",
    enabled: true,
    lastOkAt: recent,
    failCount: 0,
    ...overrides
  };
}

function item(id: number, sourceId: number, overrides: Partial<PipelineFlowItemMarkerRow> = {}): PipelineFlowItemMarkerRow {
  return {
    id,
    sourceId,
    isIndustryRelated: true,
    d1Policy: null,
    embedding: null,
    scoredAt: null,
    ...overrides
  };
}

describe("pipeline flow query helpers", () => {
  it("keeps zero-entity items green for NER when a later monotonic marker exists", () => {
    const payload = buildPipelineFlowPayload(
      [source(1)],
      [item(10, 1, { d1Policy: null, scoredAt: recent })],
      [],
      []
    );

    expect(payload.sources[0]?.perStage.ner).toBe("green");
  });

  it("uses scoredAt rather than isCurated for the curator stage", () => {
    const payload = buildPipelineFlowPayload(
      [source(1)],
      [item(10, 1, { scoredAt: recent, isCurated: false })],
      [],
      []
    );

    expect(payload.sources[0]?.perStage.curator).toBe("green");
  });

  it("excludes prefilter-filtered items from downstream denominators", () => {
    const payload = buildPipelineFlowPayload(
      [source(1)],
      [item(10, 1, { isIndustryRelated: false })],
      [],
      []
    );

    expect(payload.sources[0]?.perStage.prefilter).toBe("green");
    expect(payload.sources[0]?.perStage.ner).toBe("grey");
    expect(payload.sources[0]?.perStage.scorer).toBe("grey");
    expect(payload.sources[0]?.perStage.curator).toBe("grey");
  });

  it("applies the 0.6 threshold boundary exactly", () => {
    expect(THRESHOLD_GREEN).toBe(0.6);

    const yellowItems = Array.from({ length: 100 }, (_, index) =>
      item(index + 1, 1, { isIndustryRelated: index < 59 ? false : null })
    );
    const greenItems = Array.from({ length: 100 }, (_, index) =>
      item(index + 101, 2, { isIndustryRelated: index < 60 ? false : null })
    );

    const payload = buildPipelineFlowPayload([source(1), source(2)], [...yellowItems, ...greenItems], [], []);

    expect(payload.sources[0]?.perStage.prefilter).toBe("yellow");
    expect(payload.sources[1]?.perStage.prefilter).toBe("green");
  });
});
