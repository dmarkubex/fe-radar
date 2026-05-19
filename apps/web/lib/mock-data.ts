import type { DashboardData } from "@/lib/api/dashboard-query";
import type { TimelineItemDto, ItemDetailDto, TimelineResult } from "@/lib/api/timeline-query";
import type { TimelineFilters } from "@/lib/api/timeline-schema";
import type { AlertQuery } from "@/lib/api/alerts-schema";
import type { ScoringConfigBody } from "@/lib/api/scoring-config-schema";

const now = Date.now();
const iso = (hoursAgo: number) => new Date(now - hoursAgo * 60 * 60 * 1000).toISOString();

export const mockTimelineItems: TimelineItemDto[] = [
  {
    id: 1,
    title: "远东智慧能源中标国网江苏 2026 一批次招标，电缆标包金额待披露",
    url: "https://example.com/mock/1",
    sourceName: "电缆网",
    sourceTier: "T2",
    sourceCategory: "项目招标",
    publishedAt: iso(2),
    scoredAt: iso(1),
    summaryZh: "自家公司直接中标项目，建议跟进合同金额、交付周期和竞品份额变化。",
    category: "project",
    topCircle: "C1",
    qualityScore: 8.6,
    alertType: "own",
    alertLevel: "L1",
    clusterId: 1001,
    eventType: "中标",
    relatedCount: 2
  },
  {
    id: 2,
    title: "工信部发布《电线电缆行业规范条件（2026 修订）》征求意见稿",
    url: "https://example.com/mock/2",
    sourceName: "工信部官网",
    sourceTier: "T1",
    sourceCategory: "政府",
    publishedAt: iso(5),
    scoredAt: iso(4),
    summaryZh: "新版规范提高质量追溯和环保准入要求，利好头部企业，需评估产线合规成本。",
    category: "policy",
    topCircle: "C2",
    qualityScore: 7.9,
    alertType: "policy",
    alertLevel: "L2",
    clusterId: 1002,
    eventType: "政策发布",
    relatedCount: 1
  },
  {
    id: 3,
    title: "紫金电缆某生产车间发生火情，无人员伤亡，部分产线临时停产",
    url: "https://example.com/mock/3",
    sourceName: "第一财经能源",
    sourceTier: "T1",
    sourceCategory: "媒体-综合",
    publishedAt: iso(8),
    scoredAt: iso(7),
    summaryZh: "竞品安全事故可能影响短期交付能力，建议销售侧关注客户替代需求。",
    category: "company",
    topCircle: "C2",
    qualityScore: 7.2,
    alertType: "safety",
    alertLevel: "L1",
    clusterId: 1003,
    eventType: "安全事故",
    relatedCount: 0
  },
  {
    id: 4,
    title: "南方电网 2026 第二批次海缆招标启动，总额预计 78 亿元",
    url: "https://example.com/mock/4",
    sourceName: "北极星电力",
    sourceTier: "T2",
    sourceCategory: "媒体-垂直",
    publishedAt: iso(13),
    scoredAt: iso(12),
    summaryZh: "新增 380kV 海缆专项，宝胜、亨通、东方电缆已报名，值得持续跟踪。",
    category: "project",
    topCircle: "C2",
    qualityScore: 6.8,
    alertType: null,
    alertLevel: null,
    clusterId: 1004,
    eventType: "招标",
    relatedCount: 3
  },
  {
    id: 5,
    title: "电解铜均价上探 78,400 元/吨，创近 18 个月新高",
    url: "https://example.com/mock/5",
    sourceName: "第一财经能源",
    sourceTier: "T1",
    sourceCategory: "市场",
    publishedAt: iso(20),
    scoredAt: iso(18),
    summaryZh: "铜价上涨可能压缩电缆毛利，建议供应链评估锁价策略。",
    category: "market",
    topCircle: "C2",
    qualityScore: 6.1,
    alertType: null,
    alertLevel: null,
    clusterId: 1005,
    eventType: "价格异动",
    relatedCount: 0
  }
];

export const mockSources = [
  { id: 1, name: "工信部官网", url: "https://www.miit.gov.cn", fetcherType: "html", tier: "T1", category: "政府", enabled: true, failCount: 0, lastFetchedAt: iso(1), lastError: null, config: { type: "html", listUrl: "https://www.miit.gov.cn" } },
  { id: 2, name: "第一财经能源", url: "https://example.com/yicai", fetcherType: "rss", tier: "T1", category: "媒体-综合", enabled: true, failCount: 1, lastFetchedAt: iso(2), lastError: null, config: { type: "rss", url: "https://example.com/feed" } },
  { id: 3, name: "电缆网", url: "https://example.com/cable", fetcherType: "html", tier: "T2", category: "媒体-垂直", enabled: true, failCount: 0, lastFetchedAt: iso(3), lastError: null, config: { type: "html", listUrl: "https://example.com/cable" } },
  { id: 4, name: "演示失效信源", url: "https://example.com/broken", fetcherType: "html", tier: "T3", category: "测试", enabled: false, failCount: 8, lastFetchedAt: iso(48), lastError: "连续超时，已自动停用", config: { type: "html", listUrl: "https://example.com/broken" } }
];

export const mockScoringConfig: ScoringConfigBody = {
  weights: { w1: 0.25, w2: 0.2, w3: 0.2, w4: 0.2, w5: 0.15 },
  tCoef: { T1: 1.2, T2: 1.0, T3: 0.8 },
  cCoef: { C1: 1.2, C2: 1.0, C3: 0.8 },
  thresholds: {
    own: { C1: 60, C2: 70, C3: 80 },
    safety: { C1: 55, C2: 65, C3: 75 },
    policy: { C1: 50, C2: 60, C3: 70 },
    market: { C1: 50, C2: 60, C3: 70 },
    tech: { C1: 50, C2: 60, C3: 70 }
  }
};

export function mockDailyReport(date: string) {
  return {
    id: 1,
    date,
    generatedAt: new Date().toISOString(),
    sections: {
      hero_title: "今日重点：政策准入收紧叠加海缆招标放量",
      hero_summary: "mock mode 日报用于无数据库预览。今日信号显示，电线电缆行业规范修订与南网海缆招标同时出现，短期应关注投标窗口、铜价成本和竞品交付风险。",
      briefs: ["远东智慧能源中标国网江苏批次", "工信部行业规范修订征求意见", "紫金电缆火情导致部分产线停产"],
      stat_fetched: "128",
      stat_curated: "18",
      stat_own: "1",
      stat_safety: "1",
      stat_policy: "1",
      policy: "工信部规范修订提高准入门槛，质量追溯和环保要求会进一步强化。",
      market: "铜价继续上行，对电缆毛利形成压力，供应链锁价策略需要复核。",
      tech: "储能并网、海缆高压等级相关技术仍是近期高频主题。",
      project: "南网海缆招标启动，关注竞品报名与标包拆分。",
      company: "自家公司中标国网江苏批次，建议跟进公告金额和交付安排。"
    }
  };
}

function matchesFilters(item: TimelineItemDto, filters: TimelineFilters = {}, search?: string): boolean {
  if (filters.category && item.category !== filters.category) return false;
  if (filters.circle && item.topCircle !== filters.circle) return false;
  if (filters.tier && item.sourceTier !== filters.tier) return false;
  if (filters.eventType && item.eventType !== filters.eventType) return false;
  if (filters.alertType && item.alertType !== filters.alertType) return false;
  if (filters.curated && (item.qualityScore ?? 0) < 6.5) return false;
  if (search) {
    const haystack = `${item.title} ${item.summaryZh ?? ""} ${item.sourceName}`.toLowerCase();
    if (!haystack.includes(search.toLowerCase())) return false;
  }
  return true;
}

export function mockFetchTimeline(options: { filters?: TimelineFilters; limit?: number; search?: string }): TimelineResult {
  const limit = options.limit ?? 50;
  const items = mockTimelineItems.filter((item) => matchesFilters(item, options.filters, options.search)).slice(0, limit);
  return { items, nextCursor: null };
}

export function mockFetchItemDetail(id: number): ItemDetailDto | null {
  const item = mockTimelineItems.find((entry) => entry.id === id);
  if (!item) return null;
  return {
    ...item,
    content: `${item.title}\n\n这是 mock mode 下的正文，用于本机无数据库预览。`,
    translationZh: null,
    scores: { d1Policy: 7.5, d2Chain: 8.2, d3Market: 6.5, d4Tech: 5.8, d5Business: 7.1 },
    entities: [
      { id: 1, type: "company", canonicalName: "远东智慧能源", circle: "C1", span: "远东" },
      { id: 2, type: "organization", canonicalName: "国家电网", circle: "C2", span: "国网" }
    ],
    clusterItems: mockTimelineItems.filter((entry) => entry.clusterId === item.clusterId && entry.id !== id).map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      sourceName: entry.sourceName,
      publishedAt: entry.publishedAt,
      similarity: 0.86
    }))
  };
}

export function mockFetchAlerts(query: AlertQuery): { items: TimelineItemDto[]; nextCursor: string | null } {
  const items = mockTimelineItems.filter((item) => item.alertType && (!query.type || item.alertType === query.type) && (!query.level || item.alertLevel === query.level)).slice(0, query.limit);
  return { items, nextCursor: null };
}

export function mockFetchAlertCount(): { own: number; safety: number; policy: number } {
  return mockTimelineItems.reduce((acc, item) => {
    if (item.alertType === "own" || item.alertType === "safety" || item.alertType === "policy") acc[item.alertType] += 1;
    return acc;
  }, { own: 0, safety: 0, policy: 0 });
}

export function mockFetchDashboardData(): DashboardData {
  const scored = mockTimelineItems.length;
  const curated = mockTimelineItems.filter((item) => (item.qualityScore ?? 0) >= 6.5).length;
  const disabled = mockSources.filter((source) => !source.enabled).length;
  return {
    metrics: [
      { label: "信源", value: mockSources.length },
      { label: "已评分", value: scored },
      { label: "精选", value: curated },
      { label: "反馈", value: 3 },
      { label: "人工脱敏", value: 0 },
      { label: "合并冲突", value: 1, tone: "warning" },
      { label: "Priority 老化", value: "12%" }
    ],
    backlog: { pending: 8, droppedExpired: 1, oldPending: 1, oldPendingRatio: 0.12, tone: "default" },
    sources: { total: mockSources.length, disabled, failedSevenDays: 1 },
    alertsToday: mockFetchAlertCount(),
    mergeConflictsPending: 1,
    scrubberPending: 0,
    recentAuditCount: 12
  };
}
