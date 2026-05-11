import { NotImplementedError } from "@fe-radar/shared";
import type { EntityHit, ScoreAtoms } from "./types";

export function isPriorityItem(entities: EntityHit[], scores: ScoreAtoms): boolean {
  void entities;
  void scores;
  throw new NotImplementedError("isPriorityItem");
}
