import { NotImplementedError } from "@fe-radar/shared";
import type { AlertInput, AlertResult } from "./types";

export function computeAlert(input: AlertInput): AlertResult {
  void input;
  throw new NotImplementedError("computeAlert");
}
