import type { AlertInput, AlertResult } from "./types";

export function computeAlert(input: AlertInput): AlertResult {
  if (input.entities.some((entity) => entity.circle === "C1")) {
    return { alertType: "own", alertLevel: input.scores.d2Chain >= 90 ? "L1" : "L2" };
  }

  if (input.category === "政策与标准" || input.scores.d1Policy >= 80) {
    return { alertType: "policy", alertLevel: input.source.tier === "T1" ? "L1" : "L2" };
  }

  if (input.scores.d4Tech >= 85 || input.scores.d5Business >= 85) {
    return { alertType: "safety", alertLevel: "L3" };
  }

  return {};
}
