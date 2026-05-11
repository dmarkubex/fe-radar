import { describe, expect, it } from "vitest";
import { QUEUES } from "@fe-radar/shared";
import { buildItemPipelineFlow } from "../flows";
import { DEFAULT_JOB_OPTIONS, PIPELINE_STAGE_ORDER } from "../queues";

describe("pipeline queues", () => {
  it("uses seven serial pipeline stages", () => {
    expect(PIPELINE_STAGE_ORDER).toEqual(["fetch", "prefilter", "ner", "scorer", "embedder", "cluster", "curator"]);
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
  });

  it("builds a child-first BullMQ flow ending at curator", () => {
    const flow = buildItemPipelineFlow(1);
    expect(flow.queueName).toBe(QUEUES.curator);
    expect(flow.children?.[0]?.queueName).toBe(QUEUES.cluster);
  });
});
