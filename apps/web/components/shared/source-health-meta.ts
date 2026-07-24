export type SourceHealth = "healthy" | "stale" | "failing" | "disabled";

export const SOURCE_HEALTH_META: Record<
  SourceHealth,
  { label: string; className: string }
> = {
  healthy: { label: "正常", className: "text-ok" },
  stale: { label: "陈旧", className: "text-warn" },
  failing: { label: "失败", className: "text-danger" },
  disabled: { label: "停用", className: "text-fg-soft" },
};
