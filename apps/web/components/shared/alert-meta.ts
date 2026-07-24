const ALERT_META: Record<string, { label: string; badgeClass: string; stripClass: string }> = {
  own: {
    label: "自家公司",
    badgeClass: "bg-danger/10 text-danger",
    stripClass: "bg-danger",
  },
  legal: {
    label: "竞品涉诉",
    badgeClass: "bg-fg/10 text-fg",
    stripClass: "bg-fg",
  },
  safety: {
    label: "安全事故",
    badgeClass: "bg-warn/10 text-warn",
    stripClass: "bg-warn",
  },
  policy: {
    label: "政策突发",
    badgeClass: "bg-accent/10 text-accent",
    stripClass: "bg-accent",
  },
  risk: {
    label: "竞品风险",
    badgeClass: "bg-warn/10 text-warn",
    stripClass: "bg-warn",
  },
};

export function alertStripClass(alertType: string | null, circle: string | null): string {
  if (alertType === "own") {
    return circle === "C1" ? "bg-danger" : circle === "C2" ? "bg-accent" : "bg-sunshine-700";
  }
  if (alertType && ALERT_META[alertType]) return ALERT_META[alertType].stripClass;
  return circle === "C1" ? "bg-accent-flame" : circle === "C2" ? "bg-sunshine-700" : "bg-gold";
}

export function alertTypeLabel(alertType: string | null): string {
  return (alertType && ALERT_META[alertType]?.label) || "情报告警";
}

export function alertTypeBadgeClass(alertType: string | null): string {
  return (alertType && ALERT_META[alertType]?.badgeClass) || "bg-accent/10 text-accent";
}
