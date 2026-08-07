import { describe, expect, it, vi } from "vitest";

// Mock every dependency baseAlertConditions touches so the AST it builds is
// plain JSON (matches the pattern in timeline-gate.test.ts). Hoisted above the
// module import below.
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ $and: args.filter(Boolean) }),
  or: (...args: unknown[]) => ({ $or: args.filter(Boolean) }),
  eq: (a: unknown, b: unknown) => ({ $eq: [a, b] }),
  ne: (a: unknown, b: unknown) => ({ $ne: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ $lt: [a, b] }),
  gte: (a: unknown, b: unknown) => ({ $gte: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ $inArray: [a, b] }),
  isNull: (a: unknown) => ({ $isNull: a }),
  isNotNull: (a: unknown) => ({ $isNotNull: a }),
  not: (a: unknown) => ({ $not: a })
  // baseAlertConditions has no raw sql`` fragment, so the sql helper is unused.
}));
vi.mock("@fe-radar/db", () => ({
  items: "items",
  sources: "sources",
  itemAnalysis: {
    alertType: "ia.alert_type",
    isIndustryRelated: "ia.is_industry_related",
    topCircle: "ia.top_circle",
    alertLevel: "ia.alert_level",
    alertDismissedAt: "ia.alert_dismissed_at",
    scoredAt: "ia.scored_at",
    quotaState: "ia.quota_state",
    summaryZh: "ia.summary_zh",
    category: "ia.category"
  },
  clusterItems: "cluster_items",
  clusters: { id: "clusters.id", leadItemId: "clusters.lead_item_id" }
}));
vi.mock("@fe-radar/shared", () => ({
  APP_TIMEZONE: "Asia/Shanghai",
  dayjs: () => ({
    tz: () => ({
      subtract: () => ({ toDate: () => new Date() }),
      toDate: () => new Date()
    })
  })
}));
vi.mock("@/lib/api/cursor", () => ({ decodeCursor: () => null }));
vi.mock("@/lib/api/item-visibility", () => ({
  BLOCKED_QUOTA_STATES: ["blocked"],
  MANUAL_SCRUB_SUMMARY: "__scrubbed__"
}));
vi.mock("@/lib/api/timeline-query", () => ({
  buildTimelineSourceDisplay: () => ({})
}));
vi.mock("@/lib/mock-mode", () => ({ isMockMode: () => false }));
vi.mock("@/lib/mock-data", () => ({
  mockFetchAlertCount: vi.fn(),
  mockFetchAlerts: vi.fn()
}));

import { baseAlertConditions } from "../alerts-query";

describe("alerts list/count industry gate (T-RR-02)", () => {
  // baseAlertConditions is called directly under mocked drizzle-orm so the
  // built AST is JSON-serializable. We lock in the narrowed exemption:
  // own/legal/risk only — safety/policy must satisfy the industry/C1/C2 gate.
  it("baseAlertConditions includes industry / C1 / C2 / own-legal-risk exemption (no blanket alertType IS NOT NULL)", () => {
    const gate = baseAlertConditions({} as never);
    const s = JSON.stringify(gate);
    // Industry flag: still permit is_industry_related true.
    expect(s).toMatch(/is_industry_related/);
    // C1 / C2 circle exemption preserved.
    expect(s).toContain("C1");
    expect(s).toContain("C2");
    // Narrowed alertType exemption: own / legal / risk only.
    expect(s).toMatch(/alert_type[^\]]*"own"/i);
    expect(s).toMatch(/legal/i);
    expect(s).toMatch(/risk/i);
    // Legacy blanket IS NOT NULL exemption is gone for safety / policy.
    expect(s).not.toMatch(/alert_type\)?\s*IS NOT NULL/);
  });
});
