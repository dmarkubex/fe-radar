import postgres from "postgres";

const SEED_URL_PREFIX = "https://seed.fe-radar.local/timeline/";
const BLOCKED_URL = `${SEED_URL_PREFIX}blocked-m3-e2e`;
const MANUAL_SCRUB_SUMMARY = "[需人工脱敏]";

const DAILY_REPORT_DATES = ["2026-05-24", "2026-05-25", "2026-05-26"] as const;

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface TimelineSeed {
  slug: string;
  title: string;
  sourceName: string;
  tier: "T1" | "T2" | "T3";
  category: string;
  circle: "C1" | "C2" | "C3";
  scores: { d1: number; d2: number; d3: number; d4: number; d5: number };
  quality: number;
  alertType: string | null;
  alertLevel: string | null;
  summaryZh: string;
  blocked?: boolean;
}

const TIMELINE_SEEDS: TimelineSeed[] = [
  { slug: "001", title: "国家能源局发布《2026 储能并网技术导则》征求意见稿，9 月 1 日起施行", sourceName: "能源局官网", tier: "T1", category: "policy", circle: "C2", scores: { d1: 9.2, d2: 6.5, d3: 7.0, d4: 7.1, d5: 5.8 }, quality: 7.2, alertType: "policy", alertLevel: "L2", summaryZh: "新导则对储能并网频率响应、SOC 管理、二次设备配置提出量化要求。" },
  { slug: "002", title: "紫金电缆某车间发生火灾，无人员伤亡", sourceName: "第一财经能源", tier: "T1", category: "company", circle: "C2", scores: { d1: 6.4, d2: 7.0, d3: 5.5, d4: 3.0, d5: 8.1 }, quality: 6.0, alertType: "own", alertLevel: "L1", summaryZh: "紫金电缆是竞品企业，安全事故可能影响其产能和订单交付。" },
  { slug: "003", title: "远东智慧能源中标国网江苏 2026 一批次招标", sourceName: "电缆网", tier: "T2", category: "project", circle: "C1", scores: { d1: 5.0, d2: 7.8, d3: 6.5, d4: 4.0, d5: 7.0 }, quality: 6.1, alertType: "own", alertLevel: "L2", summaryZh: "自家公司直接中标项目，金额待公告。" },
  { slug: "004", title: "亨通光电公布 2026 Q1 业绩，营收同比 +14.2%", sourceName: "上交所公告", tier: "T1", category: "company", circle: "C2", scores: { d1: 3.0, d2: 6.0, d3: 7.2, d4: 4.5, d5: 7.2 }, quality: 5.6, alertType: null, alertLevel: null, summaryZh: "竞品亨通光电业绩稳健增长，海缆与光通信板块贡献主要增量。" },
  { slug: "005", title: "南方电网 2026 第二批次招标启动，标包总额 78 亿，含 380kV 海缆", sourceName: "电缆网", tier: "T2", category: "project", circle: "C2", scores: { d1: 4.0, d2: 8.5, d3: 7.0, d4: 5.0, d5: 6.8 }, quality: 6.3, alertType: "policy", alertLevel: "L3", summaryZh: "本批次新增海缆专项 18 亿，宝胜、亨通、东方电缆已报名。" },
  { slug: "006", title: "电解铜均价上探 78,400 元/吨，创近 18 个月新高", sourceName: "第一财经能源", tier: "T1", category: "market", circle: "C2", scores: { d1: 4.0, d2: 5.5, d3: 9.0, d4: 3.0, d5: 7.5 }, quality: 5.8, alertType: null, alertLevel: null, summaryZh: "LME + 国内现货同步上涨，对铜杆采购成本和电缆毛利传导需评估。" },
  { slug: "007", title: "工信部发布《电线电缆行业规范条件（2026 修订）》", sourceName: "能源局官网", tier: "T1", category: "policy", circle: "C2", scores: { d1: 8.5, d2: 7.0, d3: 5.0, d4: 6.0, d5: 5.0 }, quality: 6.3, alertType: "policy", alertLevel: "L2", summaryZh: "新版规范条件提高了准入门槛，强化了质量追溯和环保要求。" },
  { slug: "008", title: "江苏省 2026 年新能源消纳保障机制征求意见", sourceName: "北极星电力", tier: "T2", category: "policy", circle: "C2", scores: { d1: 7.5, d2: 6.0, d3: 6.5, d4: 5.5, d5: 4.0 }, quality: 5.9, alertType: null, alertLevel: null, summaryZh: "江苏本省新能源消纳机制调整，可能影响储能与配电网投资节奏。" },
  { slug: "009", title: "宝胜股份中标海上风电项目大单", sourceName: "上交所公告", tier: "T1", category: "project", circle: "C2", scores: { d1: 3.0, d2: 7.5, d3: 6.0, d4: 4.5, d5: 7.0 }, quality: 5.6, alertType: null, alertLevel: null, summaryZh: "竞品宝胜拿下海上风电海缆订单，值得关注其产能与技术路线。" },
  { slug: "010", title: "中国电力企业联合会发布 2026 年度电力供需形势分析报告", sourceName: "第一财经能源", tier: "T1", category: "market", circle: "C3", scores: { d1: 5.0, d2: 4.0, d3: 8.0, d4: 5.0, d5: 5.5 }, quality: 5.5, alertType: null, alertLevel: null, summaryZh: "报告预测 2026 年全社会用电量增长 5.5%，新能源装机占比将超 40%。" },
  { slug: "011", title: "全钒液流电池成本再降 12%，产业化加速", sourceName: "北极星电力", tier: "T2", category: "tech", circle: "C3", scores: { d1: 3.0, d2: 5.0, d3: 5.5, d4: 8.5, d5: 6.0 }, quality: 5.6, alertType: null, alertLevel: null, summaryZh: "液流电池技术路线在长时储能场景的经济性持续改善。" },
  { slug: "012", title: "远东智慧能源参加国际线缆展览会", sourceName: "电缆网", tier: "T2", category: "company", circle: "C1", scores: { d1: 2.0, d2: 4.0, d3: 3.0, d4: 3.5, d5: 5.5 }, quality: 3.6, alertType: null, alertLevel: null, summaryZh: "自家公司参展信息，品牌曝光。非高分条目，仅 C1 归档。" },
  { slug: "013", title: "固体电池中试线在合肥投产", sourceName: "北极星电力", tier: "T2", category: "tech", circle: "C3", scores: { d1: 2.0, d2: 3.5, d3: 4.0, d4: 9.0, d5: 5.0 }, quality: 4.7, alertType: null, alertLevel: null, summaryZh: "固态电池产业化进程加速，对传统锂电产业链的影响需要持续跟踪。" },
  { slug: "014", title: "国网浙江省电力 2026 配网物资协议库存招标公告", sourceName: "电缆网", tier: "T2", category: "project", circle: "C2", scores: { d1: 3.5, d2: 7.0, d3: 6.0, d4: 3.0, d5: 5.5 }, quality: 5.0, alertType: null, alertLevel: null, summaryZh: "浙江配网常规招标，电缆品类体量较大。" },
  { slug: "015", title: "锂电池回收利用管理办法征求意见", sourceName: "能源局官网", tier: "T1", category: "policy", circle: "C3", scores: { d1: 7.0, d2: 4.0, d3: 4.5, d4: 5.0, d5: 4.0 }, quality: 4.9, alertType: null, alertLevel: null, summaryZh: "锂电池回收新规对储能电池退役后的处理提出要求。" },
  { slug: "016", title: "远东电缆 220kV 交联电缆通过国网入网检测", sourceName: "电缆网", tier: "T2", category: "tech", circle: "C1", scores: { d1: 4.5, d2: 8.0, d3: 5.5, d4: 7.5, d5: 6.5 }, quality: 6.4, alertType: "own", alertLevel: "L3", summaryZh: "自家产品线通过关键检测，有利于后续国网投标。" },
  { slug: "017", title: "铝价回落 2.3%，电缆铝杆采购窗口打开", sourceName: "第一财经能源", tier: "T1", category: "market", circle: "C2", scores: { d1: 3.5, d2: 5.0, d3: 8.5, d4: 2.5, d5: 6.0 }, quality: 5.2, alertType: null, alertLevel: null, summaryZh: "沪铝主力合约回落，建议采购部门评估锁价策略。" },
  { slug: "018", title: "国家能源局开展分布式光伏并网专项检查", sourceName: "能源局官网", tier: "T1", category: "policy", circle: "C2", scores: { d1: 8.0, d2: 5.5, d3: 6.0, d4: 4.5, d5: 4.5 }, quality: 5.8, alertType: "policy", alertLevel: "L2", summaryZh: "专项检查聚焦并网验收与消纳责任，或影响分布式项目节奏。" },
  { slug: "019", title: "东方电缆获海上风电 35kV 阵列缆订单", sourceName: "上交所公告", tier: "T1", category: "project", circle: "C2", scores: { d1: 3.0, d2: 7.0, d3: 6.5, d4: 5.5, d5: 7.5 }, quality: 5.9, alertType: null, alertLevel: null, summaryZh: "竞品东方电缆继续巩固海上风电海缆份额。" },
  { slug: "020", title: "远东智慧能源储能电站 EPC 项目并网投运", sourceName: "北极星电力", tier: "T2", category: "project", circle: "C1", scores: { d1: 5.5, d2: 8.2, d3: 6.0, d4: 7.0, d5: 7.8 }, quality: 6.8, alertType: "own", alertLevel: "L2", summaryZh: "自家储能 EPC 项目顺利并网，可作为案例跟踪运营数据。" },
  {
    slug: "blocked-m3-e2e",
    title: "内部项目代号 ZX-2026 电缆试验数据泄露风险通报",
    sourceName: "电缆网",
    tier: "T2",
    category: "company",
    circle: "C1",
    scores: { d1: 6.0, d2: 7.0, d3: 4.0, d4: 3.0, d5: 8.0 },
    quality: 5.5,
    alertType: null,
    alertLevel: null,
    summaryZh: MANUAL_SCRUB_SUMMARY,
    blocked: true,
  },
];

function dailySections(date: string, variant: number) {
  const themes = [
    { hero: "政策密集出台、铜价创新高、竞品安全事故频发", statFetched: "1,284", statCurated: "42" },
    { hero: "南网海缆招标启动、铝价回落、分布式光伏专项检查", statFetched: "1,156", statCurated: "38" },
    { hero: "储能 EPC 并网、220kV 电缆入网、竞品订单动态", statFetched: "1,402", statCurated: "45" },
  ];
  const t = themes[variant] ?? themes[0]!;
  return {
    hero_title: t.hero,
    hero_summary: `${date} 产业情报日报（KYO-54 seed · fixed dates for M4 Kimi backtest）`,
    briefs: ["储能政策", "竞品动态", "招标信息", "原材料价格", "自家项目"],
    stat_fetched: t.statFetched,
    stat_curated: t.statCurated,
    stat_own: "3",
    stat_safety: "1",
    stat_policy: "3",
    policy: { summary: "政策与标准板块摘要（seed）", items: [{ title: "储能并网导则征求意见", source: "能源局 · T1" }] },
    market: { summary: "市场与价格板块摘要（seed）", items: [{ title: "电解铜价格跟踪", source: "第一财经 · T1" }] },
    project: { summary: "项目与招投标板块摘要（seed）", items: [{ title: "南网海缆招标", source: "电缆网 · T2" }] },
    tech: { summary: "技术与产品板块摘要（seed）", items: [{ title: "液流电池成本下降", source: "北极星 · T2" }] },
    company: { summary: "公司与资本板块摘要（seed）", items: [{ title: "竞品业绩与订单", source: "上交所 · T1" }] },
  };
}

async function main(): Promise<void> {
  const sql = postgres(env("DATABASE_URL"), { max: 1, prepare: false });

  try {
    console.log("=== seeding release data (KYO-54 · fixed seed · idempotent) ===\n");

    let sources = await sql`SELECT id, name, tier FROM sources LIMIT 10`;
    if (sources.length === 0) {
      await sql`INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled) VALUES
        ('第一财经能源', 'https://example.com/yicai', 'rss', '{"type":"rss","url":"https://example.com/feed"}'::jsonb, 'T1', '媒体-综合', true),
        ('能源局官网', 'https://example.com/nea', 'html', '{"type":"html","listUrl":"https://example.com/nea"}'::jsonb, 'T1', '政府', true),
        ('北极星电力', 'https://example.com/bjx', 'rss', '{"type":"rss","url":"https://example.com/bjx/feed"}'::jsonb, 'T2', '媒体-垂直', true),
        ('电缆网', 'https://example.com/cable', 'html', '{"type":"html","listUrl":"https://example.com/cable"}'::jsonb, 'T2', '媒体-垂直', true),
        ('上交所公告', 'https://example.com/sse', 'html', '{"type":"html","listUrl":"https://example.com/sse"}'::jsonb, 'T1', '上市公司公告', true)
      ON CONFLICT (url) DO NOTHING`;
      sources = await sql`SELECT id, name, tier FROM sources LIMIT 10`;
    }

    const sourceMap = new Map(sources.map((s: { name: string; id: number }) => [s.name, s.id]));
    const basePublishedAt = new Date("2026-05-26T12:00:00+08:00");

    for (let i = 0; i < TIMELINE_SEEDS.length; i += 1) {
      const seed = TIMELINE_SEEDS[i]!;
      const url = seed.blocked ? BLOCKED_URL : `${SEED_URL_PREFIX}${seed.slug}`;
      const sourceId = sourceMap.get(seed.sourceName) ?? sources[0]!.id;
      const publishedAt = new Date(basePublishedAt.getTime() - i * 3600_000);
      const scoredAt = new Date(publishedAt.getTime() + 5 * 60_000);
      const content = seed.blocked
        ? "联系人：张三 13800138000，内网地址 192.168.1.100，项目代号 ZX-2026。"
        : `这是关于"${seed.title}"的 release seed 正文。KYO-54 fixed seed item ${seed.slug}.`;

      const [item] = await sql`
        INSERT INTO items (source_id, url, title, content, lang, published_at)
        VALUES (${sourceId}, ${url}, ${seed.title}, ${content}, 'zh', ${publishedAt})
        ON CONFLICT (url) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          published_at = EXCLUDED.published_at
        RETURNING id`;

      const isCurated = !seed.blocked && seed.quality >= 5.0;

      await sql`
        INSERT INTO item_analysis (
          item_id, is_industry_related, summary_zh,
          d1_policy, d2_chain, d3_market, d4_tech, d5_business,
          quality_score, category, top_circle, is_curated,
          alert_level, alert_type, quota_state, scored_at
        ) VALUES (
          ${item.id}, true, ${seed.summaryZh},
          ${seed.scores.d1}, ${seed.scores.d2}, ${seed.scores.d3}, ${seed.scores.d4}, ${seed.scores.d5},
          ${seed.quality}, ${seed.category}, ${seed.circle}, ${isCurated},
          ${seed.alertLevel}, ${seed.alertType}, 'admitted', ${scoredAt}
        )
        ON CONFLICT (item_id) DO UPDATE SET
          summary_zh = EXCLUDED.summary_zh,
          d1_policy = EXCLUDED.d1_policy,
          d2_chain = EXCLUDED.d2_chain,
          d3_market = EXCLUDED.d3_market,
          d4_tech = EXCLUDED.d4_tech,
          d5_business = EXCLUDED.d5_business,
          quality_score = EXCLUDED.quality_score,
          category = EXCLUDED.category,
          top_circle = EXCLUDED.top_circle,
          is_curated = EXCLUDED.is_curated,
          alert_level = EXCLUDED.alert_level,
          alert_type = EXCLUDED.alert_type,
          quota_state = EXCLUDED.quota_state,
          scored_at = EXCLUDED.scored_at`;
    }

    console.log(`timeline items: ${TIMELINE_SEEDS.length} (${TIMELINE_SEEDS.length - 1} visible + 1 blocked M3 E2E)`);

    for (let i = 0; i < DAILY_REPORT_DATES.length; i += 1) {
      const date = DAILY_REPORT_DATES[i]!;
      await sql`
        INSERT INTO daily_reports (date, sections)
        VALUES (${date}, ${JSON.stringify(dailySections(date, i))}::jsonb)
        ON CONFLICT (date) DO UPDATE SET sections = EXCLUDED.sections, generated_at = now()`;
    }
    console.log(`daily_reports: ${DAILY_REPORT_DATES.length} (${DAILY_REPORT_DATES.join(", ")})`);

    const [blocked] = await sql`
      SELECT i.id FROM items i WHERE i.url = ${BLOCKED_URL} LIMIT 1`;
    if (blocked) {
      console.log(`blocked item id (M3 detail 404 E2E): ${blocked.id}`);
    }

    console.log("\n=== release data seeded ===");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
