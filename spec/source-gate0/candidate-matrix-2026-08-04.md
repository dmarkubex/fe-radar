# Gate 0 首批信源候选矩阵 — 2026-08-04

状态说明：`READY_FOR_CODE_SMOKE` 只表示生产网络与公开内容结构已验证；所有新增源仍默认关闭，必须通过 worker 真实抓取与相关率抽样后才可启用。

| 优先级 | 信源                 | 主办方           | 覆盖域/信号                  | 生产只读证据                                                                                                                   | 当前状态                      |
| ------ | -------------------- | ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| P0     | 国家电网公开招采     | 国家电网         | downstream/products · tender | 官方 POST 接口按“电缆”查询招标 146 条、采购 77 条；按“储能”查询招标 3 条、采购 21 条；含采购单位、公告类型、日期、文档 ID      | SEEDED_DISABLED               |
| P0     | 南方电网公开招采     | 南方电网         | downstream/products · tender | `zbcg/index.jhtml` 生产直连 HTTP 200；列表含公告分类、采购人、标题、链接、日期；官方详情存在电力电缆/低压电线/储能相关项目     | SEEDED_DISABLED               |
| P0     | 中国电建公开招采     | 中国电建         | downstream/products · tender | 新平台官方 JSON：电缆招采 3460 条、储能招采 2226 条；2026-08-04 返回当前采购公告、候选公示及成交公示，含真实发布时间和原文 PDF | SEEDED_DISABLED               |
| P0     | 国家能源集团公开招采 | 国家能源集团     | downstream/products · tender | `bidweb/` 生产直连 HTTP 200；首页返回 2026-08-03/04 的储能招标、候选公示和中标结果，链接路径携带完整发布日期                   | SEEDED_DISABLED               |
| P1     | 东方电缆官方新闻     | 东方电缆         | competitors/products         | 官方 `ajax.asp?p=ajax_news_list...` 生产直连 HTTP 200；返回 6 条当前页新闻及点号日期                                           | SEEDED_DISABLED               |
| P1     | 国家能源局能源要闻   | 国家能源局       | industry_policy              | 既有 `nea-news` JSON adapter；公开 JSON 生产直连 HTTP 200、约 860 KB                                                           | EXISTING_REPAIR_SMOKE         |
| P1     | 国家发改委新闻发布   | 国家发改委       | industry_policy/upstream     | 现有正式页与 WAP 页生产直连均 HTTP 200，正式页包含 35 个 2026 日期命中                                                         | EXISTING_SELECTOR_SMOKE       |
| P2     | 中国电器工业协会     | 中国电器工业协会 | products/industry_policy     | 现有生产复检解析 21 条                                                                                                         | EXISTING_HEALTHY              |
| P2     | 中国电力新闻网       | 中国电力报社     | industry_policy/downstream   | 现有生产复检解析 10 条，目前禁用                                                                                               | EXISTING_ACTIVATION_CANDIDATE |
| P2     | 国际能源网           | 国际能源网       | upstream/downstream/products | 现有生产复检解析 70 条，目前禁用；需保留关键词过滤                                                                             | EXISTING_ACTIVATION_CANDIDATE |

## 首批落库边界

- 本批新增国网招采、南网招采、中国电建招采、国家能源集团招采、东方电缆五行；全部 `enabled=false`、`ON CONFLICT DO NOTHING`。
- 远东电缆属于本公司，按用户确认不再新增一条候选源；本批 migration 已移除该行。
- 国网常态抓取走严格 allowlist 的 JSON adapter；Playwright 仅用于一次性发现公开接口。
- 南网与公司官网复用通用 HTML 抓取器；先修复“缺日期用抓取时间冒充”和中文/点号日期解析，再准入。
- 国家能源局、发改委等既有行不在新增 migration 中强改，避免覆盖 admin；待新验证 CLI 逐源 smoke 后单独激活。
- 中国能建旧入口虽生产 HTTP 200，但当前公开页未检出电缆/储能条目，暂不落库；国家电投新平台继续列为下一批候选。

## 第二批官方一手源

以下 7 个候选已在生产 worker 网络使用现有 `html` 抓取器只读预检，均解析出至少 3 条且带真实发布时间。migration `0048` 仍全部默认关闭，部署后逐源正式烟测达标才启用。

| 优先级 | 信源               | 覆盖域                               | 生产预检 | 最新内容   | 落库裁决                   |
| ------ | ------------------ | ------------------------------------ | -------: | ---------- | -------------------------- |
| P0     | 中天科技官方新闻   | competitors/products（含海缆、储能） |        3 | 2026-07-22 | 生产烟测、入库通过，已启用 |
| P0     | 江南电缆官方新闻   | competitors/products                 |       10 | 2026-07-09 | 生产烟测、入库通过，已启用 |
| P1     | 起帆电缆官方新闻   | competitors/products                 |        5 | 2026-04-20 | 落库但保持禁用，等待新内容 |
| P0     | CNESA 储能行业资讯 | industry_policy/products             |        6 | 2026-07-28 | 生产烟测、入库通过，已启用 |
| P0     | 阳光电源官方新闻   | competitors/downstream/products      |        5 | 2026-07-09 | 生产烟测、入库通过，已启用 |
| P0     | 海博思创官方新闻   | competitors/downstream/products      |        3 | 2026-07-30 | 生产烟测、入库通过，已启用 |
| P0     | 国轩高科官方新闻   | competitors/upstream/products        |        6 | 2026-07-31 | 生产烟测、入库通过，已启用 |

- 本批不新增远东电缆。
- 亨通、宝胜、金杯等继续留在后续批次：只在官方列表具备可追溯日期且生产解析不少于 3 条后落库。
- 6 个启用源仍需完成七日稳定性观测；当前结论仅覆盖 source ID 级生产烟测、90 天时间窗与首轮真实入库。
