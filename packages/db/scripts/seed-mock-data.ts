import postgres from "postgres";
import { randomUUID } from "node:crypto";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const sql = postgres(env("DATABASE_URL"), { max: 1, prepare: false });

  try {
    console.log("=== seeding mock data ===\n");

    // ── sources (already seeded via migration 0004, just reference) ──
    const sources = await sql`SELECT id, name, tier FROM sources LIMIT 5`;
    if (sources.length === 0) {
      console.log("no sources found, inserting 3 demo sources...");
      await sql`INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled) VALUES
        ('第一财经能源', 'https://example.com/yicai', 'rss', '{"type":"rss","url":"https://example.com/feed"}'::jsonb, 'T1', '媒体-综合', true),
        ('能源局官网', 'https://example.com/nea', 'html', '{"type":"html","listUrl":"https://example.com/nea"}'::jsonb, 'T1', '政府', true),
        ('北极星电力', 'https://example.com/bjx', 'rss', '{"type":"rss","url":"https://example.com/bjx/feed"}'::jsonb, 'T2', '媒体-垂直', true),
        ('电缆网', 'https://example.com/cable', 'html', '{"type":"html","listUrl":"https://example.com/cable"}'::jsonb, 'T2', '媒体-垂直', true),
        ('上交所公告', 'https://example.com/sse', 'html', '{"type":"html","listUrl":"https://example.com/sse"}'::jsonb, 'T1', '上市公司公告', true)
      ON CONFLICT (url) DO NOTHING`;
    }
    const allSources = await sql`SELECT id, name, tier FROM sources LIMIT 10`;
    console.log(`sources: ${allSources.length}`);

    // ── entities ──
    await sql`INSERT INTO entities (type, canonical_name, aliases, circle, weight) VALUES
      ('company', '远东智慧能源', '{"远东智慧","远东控股"}', 'C1', 1.5),
      ('company', '亨通光电', '{"亨通"}', 'C2', 1.2),
      ('company', '宝胜股份', '{"宝胜电缆"}', 'C2', 1.0),
      ('company', '紫金电缆', '{"紫金"}', 'C2', 1.0),
      ('person', '蒋锡培', '{}', 'C1', 1.3),
      ('region', '江苏省', '{"江苏"}', NULL, 0.8),
      ('technology', '储能并网', '{}', NULL, 1.0),
      ('product', '380kV 海缆', '{"海缆"}', NULL, 1.0),
      ('organization', '国家能源局', '{"能源局"}', NULL, 1.0),
      ('event', '国网2026一批次招标', '{}', NULL, 1.0)
    ON CONFLICT (type, canonical_name) DO NOTHING`;
    const allEntities = await sql`SELECT id, canonical_name, type, circle FROM entities`;
    console.log(`entities: ${allEntities.length}`);

    // ── items + analysis ──
    const mockItems = [
      {
        title: "国家能源局发布《2026 储能并网技术导则》征求意见稿，9 月 1 日起施行",
        sourceName: "能源局官网",
        tier: "T1" as const,
        category: "policy",
        circle: "C2" as const,
        scores: { d1: 9.2, d2: 6.5, d3: 7.0, d4: 7.1, d5: 5.8 },
        quality: 7.2,
        alertType: "policy",
        alertLevel: "L2",
        summaryZh: "新导则对储能并网频率响应、SOC 管理、二次设备配置提出量化要求。对自家智慧能源储能业务影响 ★★★。",
        eventType: "政策发布",
      },
      {
        title: "紫金电缆某车间发生火灾，无人员伤亡",
        sourceName: "第一财经能源",
        tier: "T1" as const,
        category: "company",
        circle: "C2" as const,
        scores: { d1: 6.4, d2: 7.0, d3: 5.5, d4: 3.0, d5: 8.1 },
        quality: 6.0,
        alertType: "own",
        alertLevel: "L1",
        summaryZh: "紫金电缆是竞品企业，安全事故可能影响其产能和订单交付，间接利好远东电缆业务线。",
        eventType: "安全事故",
      },
      {
        title: "远东智慧能源中标国网江苏 2026 一批次招标",
        sourceName: "电缆网",
        tier: "T2" as const,
        category: "project",
        circle: "C1" as const,
        scores: { d1: 5.0, d2: 7.8, d3: 6.5, d4: 4.0, d5: 7.0 },
        quality: 6.1,
        alertType: "own",
        alertLevel: "L2",
        summaryZh: "自家公司直接中标项目，金额待公告。关注后续合同细节及交货周期。",
        eventType: "中标",
      },
      {
        title: "亨通光电公布 2026 Q1 业绩，营收同比 +14.2%",
        sourceName: "上交所公告",
        tier: "T1" as const,
        category: "company",
        circle: "C2" as const,
        scores: { d1: 3.0, d2: 6.0, d3: 7.2, d4: 4.5, d5: 7.2 },
        quality: 5.6,
        alertType: null,
        alertLevel: null,
        summaryZh: "竞品亨通光电业绩稳健增长，海缆与光通信板块贡献主要增量。",
        eventType: "财报",
      },
      {
        title: "南方电网 2026 第二批次招标启动，标包总额 78 亿，含 380kV 海缆",
        sourceName: "电缆网",
        tier: "T2" as const,
        category: "project",
        circle: "C2" as const,
        scores: { d1: 4.0, d2: 8.5, d3: 7.0, d4: 5.0, d5: 6.8 },
        quality: 6.3,
        alertType: "policy",
        alertLevel: "L3",
        summaryZh: "本批次新增海缆专项 18 亿，宝胜、亨通、东方电缆已报名；竞品供应链情报值得关注。",
        eventType: "招标",
      },
      {
        title: "电解铜均价上探 78,400 元/吨，创近 18 个月新高",
        sourceName: "第一财经能源",
        tier: "T1" as const,
        category: "market",
        circle: "C2" as const,
        scores: { d1: 4.0, d2: 5.5, d3: 9.0, d4: 3.0, d5: 7.5 },
        quality: 5.8,
        alertType: null,
        alertLevel: null,
        summaryZh: "LME + 国内现货同步上涨。对铜杆采购成本和电缆毛利的传导，建议供应链部门同步评估。",
        eventType: "价格异动",
      },
      {
        title: "工信部发布《电线电缆行业规范条件（2026 修订）》",
        sourceName: "能源局官网",
        tier: "T1" as const,
        category: "policy",
        circle: "C2" as const,
        scores: { d1: 8.5, d2: 7.0, d3: 5.0, d4: 6.0, d5: 5.0 },
        quality: 6.3,
        alertType: "policy",
        alertLevel: "L2",
        summaryZh: "新版规范条件提高了准入门槛，强化了质量追溯和环保要求。利好头部企业市场份额。",
        eventType: "政策发布",
      },
      {
        title: "江苏省 2026 年新能源消纳保障机制征求意见",
        sourceName: "北极星电力",
        tier: "T2" as const,
        category: "policy",
        circle: "C2" as const,
        scores: { d1: 7.5, d2: 6.0, d3: 6.5, d4: 5.5, d5: 4.0 },
        quality: 5.9,
        alertType: null,
        alertLevel: null,
        summaryZh: "江苏本省新能源消纳机制调整，可能影响储能与配电网投资节奏。",
        eventType: "政策征求意见",
      },
      {
        title: "宝胜股份中标海上风电项目大单",
        sourceName: "上交所公告",
        tier: "T1" as const,
        category: "project",
        circle: "C2" as const,
        scores: { d1: 3.0, d2: 7.5, d3: 6.0, d4: 4.5, d5: 7.0 },
        quality: 5.6,
        alertType: null,
        alertLevel: null,
        summaryZh: "竞品宝胜拿下海上风电海缆订单，值得关注其产能与技术路线。",
        eventType: "中标",
      },
      {
        title: "中国电力企业联合会发布 2026 年度电力供需形势分析报告",
        sourceName: "第一财经能源",
        tier: "T1" as const,
        category: "market",
        circle: "C3" as const,
        scores: { d1: 5.0, d2: 4.0, d3: 8.0, d4: 5.0, d5: 5.5 },
        quality: 5.5,
        alertType: null,
        alertLevel: null,
        summaryZh: "报告预测 2026 年全社会用电量增长 5.5%，新能源装机占比将超 40%。",
        eventType: "行业报告",
      },
      {
        title: "全钒液流电池成本再降 12%，产业化加速",
        sourceName: "北极星电力",
        tier: "T2" as const,
        category: "tech",
        circle: "C3" as const,
        scores: { d1: 3.0, d2: 5.0, d3: 5.5, d4: 8.5, d5: 6.0 },
        quality: 5.6,
        alertType: null,
        alertLevel: null,
        summaryZh: "液流电池技术路线在长时储能场景的经济性持续改善，与远东储能战略相关。",
        eventType: "技术突破",
      },
      {
        title: "远东智慧能源参加国际线缆展览会",
        sourceName: "电缆网",
        tier: "T2" as const,
        category: "company",
        circle: "C1" as const,
        scores: { d1: 2.0, d2: 4.0, d3: 3.0, d4: 3.5, d5: 5.5 },
        quality: 3.6,
        alertType: null,
        alertLevel: null,
        summaryZh: "自家公司参展信息，品牌曝光。非高分条目，仅 C1 归档。",
        eventType: "展会",
      },
      {
        title: "固体电池中试线在合肥投产",
        sourceName: "北极星电力",
        tier: "T2" as const,
        category: "tech",
        circle: "C3" as const,
        scores: { d1: 2.0, d2: 3.5, d3: 4.0, d4: 9.0, d5: 5.0 },
        quality: 4.7,
        alertType: null,
        alertLevel: null,
        summaryZh: "固态电池产业化进程加速，对传统锂电产业链的影响需要持续跟踪。",
        eventType: "技术突破",
      },
      {
        title: "国网浙江省电力 2026 配网物资协议库存招标公告",
        sourceName: "电缆网",
        tier: "T2" as const,
        category: "project",
        circle: "C2" as const,
        scores: { d1: 3.5, d2: 7.0, d3: 6.0, d4: 3.0, d5: 5.5 },
        quality: 5.0,
        alertType: null,
        alertLevel: null,
        summaryZh: "浙江配网常规招标，电缆品类体量较大。关注自家投标份额。",
        eventType: "招标",
      },
      {
        title: "锂电池回收利用管理办法征求意见",
        sourceName: "能源局官网",
        tier: "T1" as const,
        category: "policy",
        circle: "C3" as const,
        scores: { d1: 7.0, d2: 4.0, d3: 4.5, d4: 5.0, d5: 4.0 },
        quality: 4.9,
        alertType: null,
        alertLevel: null,
        summaryZh: "锂电池回收新规对储能电池退役后的处理提出要求，间接影响储能系统全生命周期成本。",
        eventType: "政策征求意见",
      },
    ];

    // clear old mock data
    await sql`DELETE FROM item_entities`;
    await sql`DELETE FROM cluster_items`;
    await sql`DELETE FROM clusters`;
    await sql`DELETE FROM item_analysis`;
    await sql`DELETE FROM items`;
    await sql`DELETE FROM daily_reports`;

    const now = new Date();
    const sourceMap = new Map(allSources.map((s: any) => [s.name, s.id]));

    for (let i = 0; i < mockItems.length; i++) {
      const m = mockItems[i];
      const sourceId = sourceMap.get(m.sourceName) ?? allSources[0].id;
      const publishedAt = new Date(now.getTime() - i * 3600_000);
      const scoredAt = new Date(publishedAt.getTime() + 5 * 60_000);

      const [item] = await sql`INSERT INTO items (source_id, url, title, content, lang, published_at)
        VALUES (${sourceId}, ${`https://example.com/mock/${randomUUID()}`}, ${m.title}, ${`这是关于"${m.title}"的详细内容。这里是模拟的正文内容，用于前端测试。`}, 'zh', ${publishedAt})
        RETURNING id`;

      const isCurated = m.quality >= 5.0;

      await sql`INSERT INTO item_analysis (item_id, is_industry_related, summary_zh, d1_policy, d2_chain, d3_market, d4_tech, d5_business, quality_score, category, top_circle, is_curated, alert_level, alert_type, scored_at)
        VALUES (${item.id}, true, ${m.summaryZh}, ${m.scores.d1}, ${m.scores.d2}, ${m.scores.d3}, ${m.scores.d4}, ${m.scores.d5}, ${m.quality}, ${m.category}, ${m.circle}, ${isCurated}, ${m.alertLevel}, ${m.alertType}, ${scoredAt})`;

      // link entities
      const matchedEntities = allEntities.filter((e: any) => {
        return m.summaryZh.includes(e.canonicalName)
          || m.title.includes(e.canonicalName)
          || (e.aliases as string[]).some((a: string) => m.title.includes(a) || m.summaryZh.includes(a));
      });
      for (const entity of matchedEntities) {
        await sql`INSERT INTO item_entities (item_id, entity_id, span)
          VALUES (${item.id}, ${entity.id}, ${entity.canonicalName})
          ON CONFLICT DO NOTHING`;
      }
    }
    console.log(`items: ${mockItems.length} (with analysis + entity links)`);

    // ── 1 cluster ──
    const top2Items = await sql`SELECT i.id FROM items i JOIN item_analysis a ON a.item_id = i.id ORDER BY a.quality_score DESC LIMIT 2`;
    if (top2Items.length >= 2) {
      await sql`INSERT INTO clusters (event_type, lead_item_id) VALUES ('招标', ${top2Items[0].id}) RETURNING id`.then(async ([cluster]: any[]) => {
        for (const item of top2Items) {
          await sql`INSERT INTO cluster_items (cluster_id, item_id, similarity) VALUES (${cluster.id}, ${item.id}, ${0.85}) ON CONFLICT DO NOTHING`;
        }
      });
      console.log("clusters: 1 (with 2 items)");
    }

    // ── daily report ──
    const today = now.toISOString().slice(0, 10);
    await sql`INSERT INTO daily_reports (date, sections) VALUES (${today}, ${JSON.stringify({
      hero_title: "政策密集出台、铜价创新高、竞品安全事故频发",
      hero_summary: "今日储能并网导则与线缆行业规范双发，铜价突破 78,400 创 18 月新高，紫金电缆火灾事故引发行业关注。自家公司中标国网江苏招标、参展国际线缆展。",
      briefs: ["储能并网导则 9 月施行", "紫金电缆车间火灾", "远东中标国网江苏", "铜价 78,400 新高", "南网 78 亿海缆招标"],
      stat_fetched: "1,284",
      stat_curated: "42",
      stat_own: "3",
      stat_safety: "1",
      stat_policy: "3",
      policy: {
        summary: "国家能源局发布储能并网技术导则征求意见稿，9 月 1 日起施行。工信部同步修订电线电缆行业规范条件，提高准入门槛。",
        lead: { title: "储能并网技术导则征求意见", summary: "对频率响应、SOC 管理提出量化要求", source: "能源局官网", time: "09:32", score: "7.2" },
        items: [
          { title: "线缆行业规范条件修订", source: "工信部 · T1" },
          { title: "锂电池回收利用管理办法征求意见", source: "能源局官网 · T1" },
        ],
      },
      market: {
        summary: "电解铜均价上探 78,400 元/吨，LME + 国内现货同步上涨。对铜杆采购成本和电缆毛利的传导效应需持续评估。",
        lead: { title: "电解铜创新高", summary: "建议供应链部门同步评估", source: "第一财经", time: "13:42", score: "5.8" },
        items: [
          { title: "2026 年度电力供需形势分析", source: "中电联 · T1" },
        ],
      },
      project: {
        summary: "南方电网 78 亿海缆招标启动，国网江苏一批次结果出炉，远东智慧能源成功中标。",
        lead: { title: "南网 78 亿海缆招标", summary: "新增海缆专项 18 亿", source: "电缆网", time: "11:08", score: "6.3" },
        items: [
          { title: "远东中标国网江苏一批次", source: "电缆网 · T2" },
          { title: "宝胜海上风电大单", source: "上交所 · T1" },
          { title: "浙江配网协议库存招标", source: "电缆网 · T2" },
        ],
      },
      tech: {
        summary: "全钒液流电池成本再降 12%，固态电池中试线在合肥投产，储能技术路线多元化加速。",
        items: [
          { title: "全钒液流电池成本降 12%", source: "北极星 · T2" },
          { title: "固态电池中试线投产", source: "北极星 · T2" },
        ],
      },
      company: {
        summary: "紫金电缆车间火灾事故、亨通光电 Q1 营收 +14.2%、远东智慧能源参展国际线缆展。",
        lead: { title: "紫金电缆火灾事故", summary: "无人员伤亡，可能影响竞品产能", source: "第一财经", time: "09:51", score: "6.0" },
        items: [
          { title: "亨通光电 Q1 营收 +14.2%", source: "上交所 · T1" },
          { title: "远东智慧能源参展国际线缆展", source: "电缆网 · T2" },
        ],
      },
    })}::jsonb) ON CONFLICT (date) DO UPDATE SET sections = EXCLUDED.sections, generated_at = now()`;
    console.log(`daily_report: ${today}`);

    console.log("\n=== mock data seeded ===");
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
