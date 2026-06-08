export const APP_NAME = "FE-Radar";
export const APP_TIMEZONE = "Asia/Shanghai";

export const DAILY_BUDGET_NORMAL = 1300;
export const DAILY_BUDGET_PRIORITY = 200;

export const QUEUES = {
  fetch: "fe-fetch",
  prefilter: "fe-prefilter",
  ner: "fe-ner",
  scorer: "fe-scorer",
  embedder: "fe-embedder",
  cluster: "fe-cluster",
  curator: "fe-curator",
  daily: "fe-daily"
} as const;

// Non-pipeline BullMQ queue names. Single source of truth shared by worker
// (queue/worker construction) and web (monitoring) to avoid literal drift.
// NOTE: BullMQ 5 rejects ':' in queue names ("Queue name cannot contain :"),
// so cleanup MUST be "fe-cleanup", never "fe:cleanup".
export const QUEUE_CLEANUP = "fe-cleanup";

export const USER_ROLES = ["viewer", "editor", "admin"] as const;
