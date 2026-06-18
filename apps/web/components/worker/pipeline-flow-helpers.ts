import type { PipelineFlowPayload, PipelineLight, PipelineStageKey, SourceTier } from "@/lib/api/pipeline-flow-query";

export type { PipelineFlowPayload, PipelineLight, PipelineStageKey, SourceTier };

export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
}

export interface QueueRow {
  key: string;
  label: string;
  counts: QueueCounts;
  nextRunIso: string | null;
}

export function lightToClass(light: PipelineLight): string {
  switch (light) {
    case "green":
      return "text-ok";
    case "yellow":
      return "text-warn";
    case "red":
      return "text-danger";
    case "grey":
    default:
      return "text-fg-soft";
  }
}

export function lightToLabel(light: PipelineLight): string {
  switch (light) {
    case "green":
      return "正常";
    case "yellow":
      return "警告";
    case "red":
      return "失败";
    case "grey":
    default:
      return "跳过";
  }
}

export function queueToNodeLight(counts: QueueCounts | undefined): PipelineLight {
  if (!counts) return "grey";
  if (counts.failed > 0) return "red";
  if (counts.active > 0) return "green";
  if (counts.waiting > 0) return "yellow";
  return "grey";
}

export interface StageSourceLight {
  id: number;
  name: string;
  tier: SourceTier;
  light: PipelineLight;
}

export function getStageSourceLights(
  payload: PipelineFlowPayload,
  stageKey: PipelineStageKey
): StageSourceLight[] {
  return payload.sources.map((source) => ({
    id: source.id,
    name: source.name,
    tier: source.tier,
    light: source.perStage[stageKey]
  }));
}

