import type { USER_ROLES } from "./constants";

export type UserRole = (typeof USER_ROLES)[number];
export type SourceTier = "T1" | "T2" | "T3";
export type Circle = "C1" | "C2" | "C3";
export type AlertType = "own" | "safety" | "policy";
export type AlertLevel = "L1" | "L2" | "L3";
export type QuotaState = "admitted" | "pending_over_quota" | "dropped_quota_expired" | "dropped_filter";

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
