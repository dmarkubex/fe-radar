import { NotImplementedError } from "@fe-radar/shared";
import type { ClusterDecision, ClusterInput } from "./types";

export function decideCluster(input: ClusterInput): ClusterDecision {
  void input;
  throw new NotImplementedError("decideCluster");
}
