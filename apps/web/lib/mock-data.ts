import type { DashboardData } from "@/lib/api/dashboard-query";
import type { TimelineItemDto, ItemDetailDto, TimelineResult } from "@/lib/api/timeline-query";
import type { TimelineFilters } from "@/lib/api/timeline-schema";
import type { AlertQuery } from "@/lib/api/alerts-schema";
import type { ScoringConfigBody } from "@/lib/api/scoring-config-schema";
import { decodeCursor, encodeCursor } from "@/lib/api/cursor";
import { APP_TIMEZONE, dayjs } from "@fe-radar/shared";

const mockBaseDay = dayjs().tz(APP_TIMEZONE).startOf("day").subtract(1, "day");
const iso = (hoursAgo: number) => dayjs().tz(APP_TIMEZONE).subtract(hoursAgo, "hour").toISOString();
const mockPublishedAt = (daysBeforeBase: number, hour: number, minute: number) =>
  mockBaseDay.subtract(daysBeforeBase, "day").hour(hour).minute(minute).second(0).millisecond(0).toISOString();
const mockScoredAt = (publishedAt: string, minutesLater: number) => dayjs(publishedAt).tz(APP_TIMEZONE).add(minutesLater, "minute").toISOString();

const p0Evening = mockPublishedAt(0, 20, 15);
const p0Afternoon = mockPublishedAt(0, 14, 5);
const p0Morning = mockPublishedAt(0, 9, 30);
const p1Evening = mockPublishedAt(1, 19, 40);
const p1Afternoon = mockPublishedAt(1, 13, 20);
const p1Morning = mockPublishedAt(1, 8, 15);
const p2Evening = mockPublishedAt(2, 18, 10);
const p2Afternoon = mockPublishedAt(2, 15, 45);
const p2Morning = mockPublishedAt(2, 7, 50);

export const mockTimelineItems: TimelineItemDto[] = [
  {
    id: 30,
    title: "远东智慧能源中标国网江苏电缆框架采购，标包金额待披露",
    url: "https://example.com/mock/30",
    sourceName: "电缆网",
    sourceTier: "T2",
    sourceCategory: "项目招标",
    publishedAt: p0Evening,
    scoredAt: mockScoredAt(p0Evening, 30),
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
    id: 29,
    title: "工信部发布电线电缆行业规范条件修订征求意见稿",
    url: "https://example.com/mock/29",
    sourceName: "工信部官网",
    sourceTier: "T1",
    sourceCategory: "政府",
    publishedAt: p0Evening,
    scoredAt: mockScoredAt(p0Evening, 30),
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
    id: 28,
    title: "紫金电缆生产车间发生火情，无人员伤亡，部分产线临时停产",
    url: "https://example.com/mock/28",
    sourceName: "第一财经能源",
    sourceTier: "T1",
    sourceCategory: "媒体-综合",
    publishedAt: p0Afternoon,
    scoredAt: mockScoredAt(p0Afternoon, 25),
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
    id: 27,
    title: "南方电网第二批电缆与海缆招标启动，总额预计 78 亿元",
    url: "https://example.com/mock/27",
    sourceName: "北极星电力",
    sourceTier: "T2",
    sourceCategory: "媒体-垂直",
    publishedAt: p0Morning,
    scoredAt: mockScoredAt(p0Morning, 35),
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
    id: 26,
    title: "亨通光电披露电缆业务涉诉公告，投标影响待评估",
    url: "https://example.com/mock/26",
    sourceName: "巨潮-C2电缆竞品涉诉",
    sourceTier: "T1",
    sourceCategory: "上市公司涉诉",
    publishedAt: p1Evening,
    scoredAt: mockScoredAt(p1Evening, 20),
    summaryZh: "竞品亨通光电新增诉讼披露，建议法务与销售侧评估供应链与投标影响。",
    category: "company",
    topCircle: "C2",
    qualityScore: 7.4,
    alertType: "legal",
    alertLevel: "L2",
    clusterId: 1006,
    eventType: "涉诉",
    relatedCount: 0
  },
  {
    id: 25,
    title: "铜价上行推高电缆成本，头部企业启动锁价复核",
    url: "https://example.com/mock/25",
    sourceName: "上海有色网 SMM",
    sourceTier: "T2",
    sourceCategory: "原料价格",
    publishedAt: p1Afternoon,
    scoredAt: mockScoredAt(p1Afternoon, 20),
    summaryZh: "铜价波动对电缆毛利形成压力，采购侧需复核套保与长协策略。",
    category: "market",
    topCircle: "C2",
    qualityScore: 6.9,
    alertType: null,
    alertLevel: null,
    clusterId: 1007,
    eventType: "价格波动",
    relatedCount: 1
  },
  {
    id: 24,
    title: "中汽协更新新能源车产销数据，带动高压电缆需求预期",
    url: "https://example.com/mock/24",
    sourceName: "中汽协",
    sourceTier: "T1",
    sourceCategory: "协会",
    publishedAt: p1Morning,
    scoredAt: mockScoredAt(p1Morning, 20),
    summaryZh: "新能源车产销增长提升高压线束与电缆需求预期，建议关注车企订单节奏。",
    category: "market",
    topCircle: "C3",
    qualityScore: 6.6,
    alertType: null,
    alertLevel: null,
    clusterId: 1008,
    eventType: "需求变化",
    relatedCount: 2
  },
  {
    id: 23,
    title: "国家能源局发布储能并网通知，电缆配套验收要求趋严",
    url: "https://example.com/mock/23",
    sourceName: "国家能源局",
    sourceTier: "T1",
    sourceCategory: "政府",
    publishedAt: p2Evening,
    scoredAt: mockScoredAt(p2Evening, 15),
    summaryZh: "储能并网验收要求强化，可能带动电缆配套检测和交付资料标准化。",
    category: "policy",
    topCircle: "C2",
    qualityScore: 7.1,
    alertType: "policy",
    alertLevel: "L2",
    clusterId: 1009,
    eventType: "政策发布",
    relatedCount: 1
  },
  {
    id: 22,
    title: "海外海风项目释放电缆订单，东方电缆与中天科技入围",
    url: "https://example.com/mock/22",
    sourceName: "北极星电力",
    sourceTier: "T2",
    sourceCategory: "媒体-垂直",
    publishedAt: p2Afternoon,
    scoredAt: mockScoredAt(p2Afternoon, 15),
    summaryZh: "海外海风项目释放海缆订单，竞品入围情况值得跟踪。",
    category: "project",
    topCircle: "C2",
    qualityScore: 6.7,
    alertType: null,
    alertLevel: null,
    clusterId: 1010,
    eventType: "入围",
    relatedCount: 2
  },
  {
    id: 21,
    title: "地方电网启动配网改造，低压电缆集采节奏提前",
    url: "https://example.com/mock/21",
    sourceName: "电缆网",
    sourceTier: "T2",
    sourceCategory: "项目招标",
    publishedAt: p2Morning,
    scoredAt: mockScoredAt(p2Morning, 15),
    summaryZh: "配网改造项目提前释放低压电缆集采需求，需关注区域客户预算窗口。",
    category: "project",
    topCircle: "C3",
    qualityScore: 6.4,
    alertType: null,
    alertLevel: null,
    clusterId: 1011,
    eventType: "招标",
    relatedCount: 1
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
    generatedAt: dayjs().tz(APP_TIMEZONE).toISOString(),
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

function compareIsoDesc(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dayjs(b).valueOf() - dayjs(a).valueOf();
}

function sortTimelineItems(items: TimelineItemDto[], filters: TimelineFilters = {}): TimelineItemDto[] {
  return [...items].sort((a, b) => {
    const primary = filters.curated ? (b.qualityScore ?? 0) - (a.qualityScore ?? 0) : compareIsoDesc(a.publishedAt, b.publishedAt);
    return primary || b.id - a.id;
  });
}

function cursorAtForTimeline(item: TimelineItemDto, filters: TimelineFilters = {}): string | null {
  return filters.curated ? item.scoredAt : item.publishedAt;
}

function afterKeysetCursor(item: TimelineItemDto, cursor: string | undefined, filters: TimelineFilters = {}): boolean {
  const parsed = decodeCursor(cursor);
  if (!parsed) return true;
  const at = cursorAtForTimeline(item, filters);
  if (!at) return false;
  const itemAt = dayjs(at).valueOf();
  const cursorAt = dayjs(parsed.at).valueOf();
  return itemAt < cursorAt || (itemAt === cursorAt && item.id < parsed.id);
}

function encodeTimelineMockCursor(item: TimelineItemDto, filters: TimelineFilters = {}): string | null {
  const at = cursorAtForTimeline(item, filters);
  return at ? encodeCursor({ at, id: item.id }) : null;
}

export function mockFetchTimeline(options: { filters?: TimelineFilters; limit?: number; search?: string; cursor?: string }): TimelineResult {
  const limit = options.limit ?? 50;
  const filters = options.filters ?? {};
  const rows = sortTimelineItems(
    mockTimelineItems
      .filter((item) => matchesFilters(item, filters, options.search))
      .filter((item) => afterKeysetCursor(item, options.cursor, filters)),
    filters
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > limit && last ? encodeTimelineMockCursor(last, filters) : null
  };
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
  const cursor = decodeCursor(query.cursor);
  const rows = mockTimelineItems
    .filter((item) => item.alertType && (!query.type || item.alertType === query.type) && (!query.level || item.alertLevel === query.level))
    .filter((item) => {
      if (!cursor || !item.scoredAt) return !cursor;
      const itemAt = dayjs(item.scoredAt).valueOf();
      const cursorAt = dayjs(cursor.at).valueOf();
      return itemAt < cursorAt || (itemAt === cursorAt && item.id < cursor.id);
    })
    .sort((a, b) => compareIsoDesc(a.scoredAt, b.scoredAt) || b.id - a.id);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor: rows.length > query.limit && last?.scoredAt ? encodeCursor({ at: last.scoredAt, id: last.id }) : null
  };
}

export function mockFetchAlertCount(): { own: number; safety: number; policy: number; legal: number } {
  return mockTimelineItems.reduce((acc, item) => {
    if (item.alertType === "own" || item.alertType === "safety" || item.alertType === "policy" || item.alertType === "legal") {
      acc[item.alertType] += 1;
    }
    return acc;
  }, { own: 0, safety: 0, policy: 0, legal: 0 });
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
