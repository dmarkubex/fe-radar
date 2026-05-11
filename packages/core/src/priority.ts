import type { EntityHit, ScoreAtoms } from "./types";

export function isPriorityItem(entities: EntityHit[], scores: ScoreAtoms): boolean {
  return entities.some((entity) => entity.circle === "C1") || scores.d1Policy >= 85 || scores.d2Chain >= 85;
}

export interface BacklogItem {
  fetchedAt: Date;
  priority: boolean;
}

export interface BacklogMetrics {
  priorityBacklogAgeP95Seconds: number;
  priorityBacklogSize: number;
  priorityBacklogStaleRatio: number;
  isRed: boolean;
}

export function computePriorityBacklogMetrics(items: BacklogItem[], now = new Date()): BacklogMetrics {
  const priorityItems = items.filter((item) => item.priority);
  const ages = priorityItems.map((item) => Math.max(0, Math.floor((now.getTime() - item.fetchedAt.getTime()) / 1000))).sort((a, b) => a - b);
  const p95Index = ages.length === 0 ? 0 : Math.ceil(ages.length * 0.95) - 1;
  const staleCount = ages.filter((age) => age > 24 * 60 * 60).length;
  const staleRatio = priorityItems.length === 0 ? 0 : staleCount / priorityItems.length;
  return {
    priorityBacklogAgeP95Seconds: ages[p95Index] ?? 0,
    priorityBacklogSize: priorityItems.length,
    priorityBacklogStaleRatio: staleRatio,
    isRed: staleRatio > 0.3
  };
}
