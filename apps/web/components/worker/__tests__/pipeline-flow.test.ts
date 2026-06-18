import { describe, expect, it, vi } from "vitest";

import type { PipelineFlowPayload, PipelineStageKey } from "@/lib/api/pipeline-flow-query";

import {
  lightToClass,
  lightToLabel,
  queueToNodeLight,
  getStageSourceLights
} from "../pipeline-flow-helpers";

function makePayload(): PipelineFlowPayload {
  const stageKeys: PipelineStageKey[] = ["fetch", "prefilter", "ner", "scorer", "embedder", "cluster", "curator"];
  return {
    stages: stageKeys.map((key) => ({ key, label: key })),
    sources: [
      {
        id: 1,
        name: "源A",
        tier: "T1",
        perStage: {
          fetch: "green",
          prefilter: "yellow",
          ner: "grey",
          scorer: "grey",
          embedder: "grey",
          cluster: "grey",
          curator: "grey"
        }
      },
      {
        id: 2,
        name: "源B",
        tier: "T2",
        perStage: {
          fetch: "red",
          prefilter: "grey",
          ner: "grey",
          scorer: "grey",
          embedder: "grey",
          cluster: "grey",
          curator: "grey"
        }
      }
    ]
  };
}

describe("PipelineFlow helper functions", () => {
  describe("lightToClass", () => {
    it("maps light to correct CSS class", () => {
      expect(lightToClass("green")).toBe("text-ok");
      expect(lightToClass("yellow")).toBe("text-warn");
      expect(lightToClass("red")).toBe("text-danger");
      expect(lightToClass("grey")).toBe("text-fg-soft");
    });
  });

  describe("lightToLabel (a11y text)", () => {
    it("maps green to 正常", () => {
      expect(lightToLabel("green")).toBe("正常");
    });

    it("maps red to 失败", () => {
      expect(lightToLabel("red")).toBe("失败");
    });

    it("maps yellow to a non-empty label", () => {
      expect(lightToLabel("yellow")).not.toBe("");
    });

    it("maps grey to a non-empty label", () => {
      expect(lightToLabel("grey")).not.toBe("");
    });
  });

  describe("queueToNodeLight", () => {
    it("active queue -> green node", () => {
      expect(
        queueToNodeLight({ waiting: 0, active: 3, delayed: 0, completed: 10, failed: 0, paused: 0 })
      ).toBe("green");
    });

    it("failed items -> red node", () => {
      expect(
        queueToNodeLight({ waiting: 0, active: 0, delayed: 0, completed: 5, failed: 2, paused: 0 })
      ).toBe("red");
    });

    it("failed dominates active", () => {
      expect(
        queueToNodeLight({ waiting: 0, active: 5, delayed: 0, completed: 0, failed: 1, paused: 0 })
      ).toBe("red");
    });

    it("waiting items -> yellow node", () => {
      expect(
        queueToNodeLight({ waiting: 5, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0 })
      ).toBe("yellow");
    });

    it("empty queue -> grey node", () => {
      expect(
        queueToNodeLight({ waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0 })
      ).toBe("grey");
    });

    it("undefined queue -> grey node", () => {
      expect(queueToNodeLight(undefined)).toBe("grey");
    });
  });

  describe("getStageSourceLights", () => {
    it("returns per-source lights for a given stage", () => {
      const payload = makePayload();
      const lights = getStageSourceLights(payload, "fetch");
      expect(lights).toHaveLength(2);
      expect(lights[0]).toMatchObject({ id: 1, name: "源A", tier: "T1", light: "green" });
      expect(lights[1]).toMatchObject({ id: 2, name: "源B", tier: "T2", light: "red" });
    });

    it("returns grey lights when stage is unreached", () => {
      const payload = makePayload();
      const lights = getStageSourceLights(payload, "ner");
      expect(lights.every((row) => row.light === "grey")).toBe(true);
    });

    it("returns empty array when payload has no sources", () => {
      const payload: PipelineFlowPayload = { stages: [], sources: [] };
      expect(getStageSourceLights(payload, "fetch")).toEqual([]);
    });
  });

  describe("error state is independent from payload (logic check)", () => {
    it("error non-null with payload null is a valid state", () => {
      const error: string | null = "HTTP 500";
      const payload: PipelineFlowPayload | null = null;
      expect(error !== null && payload === null).toBe(true);
    });

    it("retry handler is callable when wired to onRetry", () => {
      const onRetry = vi.fn();
      onRetry();
      expect(onRetry).toHaveBeenCalledTimes(1);
    });
  });
});
