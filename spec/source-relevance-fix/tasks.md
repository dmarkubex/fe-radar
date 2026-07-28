# 信源相关性修复 — 任务卡 (source-relevance-fix)

> 来源：2026-07-27 对「时间线新闻居多、与主业（线缆/光纤/储能）相关性不足」的代码级 + 网络实测根因分析。
> 核心结论 = **供给侧塌方（垂直源大面积禁用且无复检闭环）+ 需求侧闸门刻意宽松（fail-open + 告警豁免）** 两层叠加。
> 模式：Standard（跨 db/worker/web/llm/运维，中风险）。
> 评审门槛：`pnpm -r typecheck` 0 error + `pnpm -r test` 全绿；对抗性代码评审 APPROVE；主会话独立复核。
> AI 产出标 `needs_human_review`，不得宣称可直接上线。

## 根因摘要（每条都对应下方任务卡）

| #   | 根因                                                                                                                            | 证据                                                                                                                     | 对应卡              |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| R1  | seed 验证在**失真网络**（本机全流量走代理，DNS 全解析为 `198.18.0.x` fake-ip）中进行，政府站屏蔽代理出口 → 被误判"不可达"并禁用 | `0014` 注释 `current agent network cannot reach .gov.cn; keep disabled until deployment-network smoke returns >=3 items` | T-REL-02            |
| R2  | 「等部署网络复测」**从未闭环**；`verify-sources.ts:130` 只查 `enabled: true`，被禁用的源在设计上永远不会被复检                  | `packages/db/scripts/verify-sources.ts`                                                                                  | T-REL-01            |
| R3  | 网站改版 / selector 失效后只做了「禁用」处置，没有跟进修复                                                                      | `0011`/`0014` 中 NEA 404、CNESA 0 items                                                                                  | T-REL-03 / T-REL-04 |
| R4  | 三个旧列表路径失效；迁移链已将 CPIA / escn 修到可达首页，CWEA 仍因 JS 动态注入不可抓取                                          | `0023_sources_fetch_refresh.sql` + 2026-07-27 首页复核                                                                   | T-REL-05            |
| R5  | 幸存的 T3 源**名不副实**：显示"36氪 新能源"实抓全站快讯，"第一财经 能源"实抓全站头条                                            | `0015_sources_rsshub_finance.sql`                                                                                        | T-REL-06            |
| R6  | 三大主业中**光纤覆盖为零**：prefilter prompt、关键词表、信源 seed 全无「光纤/光缆/光通信」                                      | 全仓库 grep 无命中（仅 C2 实体名亨通/中天）                                                                              | T-REL-07            |
| R7  | `alertType IS NOT NULL` 无条件豁免行业闸门，NER 误报 `event_type=事故` 即可「保送」上线                                         | `timeline-query.ts:188` + `packages/core/src/alert.ts:62`                                                                | T-REL-08            |

## 合规红线（全卡通用，违反 = 评审驳回）

- **索比光伏网（`https://www.solarbe.com/news/`）禁止重新启用** —— 禁用原因是 `robots.txt Disallow: /news/`（见 `0017_disable_solarbe_robots.sql`），不是 selector 问题。**雪球 / 搜狗微信（电缆头条·储能头条）同样保持禁用**。任何卡都不得改它们的 `enabled` 或绕过 `assertRobotsAllowed`。
- 代理池**仅用于绕机房 IP 封禁，不得绕 robots.txt**。
- **不存原始 HTML 快照**（FR-12）。
- 公网 LLM 调用前必经 `packages/core/scrubber.ts`。
- 配置存 DB 不硬编码；**不改任何已发布迁移**；新迁移从 **0038** 起顺序占号（当前最大 `0037`）。
- 迁移必须幂等，且尊重 `admin_snapshot` / `admin_touched_at` 保护（不覆盖 admin 后台改过的行）。
- TZ=Asia/Shanghai，一律 `dayjs().tz()`。
- commit message：`[T-REL-0X] 动词 + 范围`。

## 迁移号预分配（防并行撞号）

| 号   | 卡       | 用途                              |
| ---- | -------- | --------------------------------- |
| 0038 | T-REL-02 | 政府/协会源代理复测后批量重激活   |
| 0039 | T-REL-03 | 国家能源局改版 URL + fetcher 切换 |
| 0040 | T-REL-04 | CNESA selector 刷新               |
| 0041 | T-REL-05 | CWEA 软禁状态固化                 |
| 0042 | T-REL-06 | 泛财经源 keywordFilter + 源名正名 |
| 0043 | T-REL-07 | 光纤信源 seed + 光纤关键词补齐    |
| 0044 | T-REL-01 | robots 禁源复检合规门禁           |

---

## T-REL-00 — 现状盘点（只读，其余卡的前置）

- **goal**：用生产库数据把「代码层推断」换成「数据层事实」，确定各卡的真实优先级与影响面。**只读，不改任何东西。**
- **constraints**：
  - 只在部署环境（或其只读副本）执行，不在本机失真网络下判断可达性。
  - 输出落盘到 `spec/source-relevance-fix/baseline.md`，作为后续卡的验收对照基线。
- **ask_agent_first**：无（诊断卡）。
- **owner**：运维（human）执行 SQL，主会话汇总。
- **scope**：只读 SQL，无文件改动。
- **rollback**：不适用。
- **acceptance**：产出下列 5 组数据——
  1. 信源盘点：`SELECT tier, category, enabled, count(*) FROM sources GROUP BY 1,2,3 ORDER BY 1,2,3;`
  2. 近 7 天各源实际产出：`SELECT s.name, s.tier, count(i.id) FROM sources s LEFT JOIN items i ON i.source_id=s.id AND i.fetched_at > now()-interval '7 days' GROUP BY 1,2 ORDER BY 3 DESC;`
  3. **行业闸门三态分布**：`SELECT is_industry_related, count(*) FROM item_analysis a JOIN items i ON i.id=a.item_id WHERE i.fetched_at > now()-interval '7 days' GROUP BY 1;`（判断 fail-open 的 `null` 占比）
  4. **R7 验证（决定 T-REL-08 是否成立）**：`SELECT alert_type, is_industry_related, count(*) FROM item_analysis a JOIN items i ON i.id=a.item_id WHERE i.fetched_at > now()-interval '7 days' AND alert_type IS NOT NULL GROUP BY 1,2;` —— 若存在 `alert_type='safety' AND is_industry_related=false` 的行，则「告警保送」通道**实锤成立**；若为 0，T-REL-08 降级为预防性加固。
  5. 自动禁用盘点：`SELECT name, fail_count, last_error, last_error_at FROM sources WHERE enabled=false ORDER BY fail_count DESC;`

---

## T-REL-01 — 修复信源复检闭环（`verify-sources` 支持 disabled 源）

- **goal**：让「禁用 → 等复测 → 重启用」这条链路真正闭合。当前 `verify-sources.ts:130` 硬编码 `listSources(db, { enabled: true })`，**被禁用的源永远不会被复检**，这是 R1/R2/R3 长期固化的机制性原因。
- **constraints**：
  - 新增 CLI flag `--include-disabled`（默认关闭，保持现有 CI 行为零变化）。
  - **可达性比例门（`ratio < 0.8` throw）只对 enabled 源计算**，disabled 源的探测结果仅作报告输出，不参与门禁 —— 否则加入一堆已知坏源会让 CI 必挂。
  - 输出对 disabled 源额外标注 `[DISABLED]` 前缀与「建议：可重新启用 / 仍不可达」两态结论。
  - 探测**不得**自动写库改 `enabled`（重启用必须走迁移或 admin 后台，保留审计链）。
  - 复用现有 `suggestionFor()` 分类逻辑，不另造一套。
- **ask_agent_first**：是否顺带把 `fetcher_type='crawl'/'datapro'/'websearch'/'announcement'` 纳入探测（当前落到 `Unsupported fetcher_type` 分支）。倾向：本卡不扩，只加 `--include-disabled`，保持单一变更。
- **owner**：实现器。
- **scope**：`packages/db/scripts/verify-sources.ts`、`packages/db/src/__tests__/verify-sources.test.ts`、`packages/db/package.json`（如需加 script 别名）。
- **rollback**：还原上述文件，行为回到只查 enabled。
- **acceptance**：
  1. 不带 flag 时行为与现在**逐字节一致**（现有测试不回归）。
  2. 带 `--include-disabled` 时 disabled 源出现在报告中并带 `[DISABLED]` 标记。
  3. 单测覆盖：disabled 源全挂时 `ratio` 门禁**不触发**（关键回归点）。
  4. typecheck 0 error；`pnpm --filter @fe-radar/db test` 绿。

---

## T-REL-02 — 政府 / 协会 T1 源代理通电复测 + 批量重激活

- **goal**：在**部署内网 + 代理池通电**的真实网络下复测被 R1 误杀的一批 T1 源（国家发改委 / 工信部 / 中电联 / 中国能源报 / 巨潮），据实重新启用。这是投入产出比最高的一卡——T1 源是产业情报的相关性基石。
- **前置**：`handoff.md` Human Action Required 的 P0 第①项（住宅代理 `docker secret create proxy_list` + `PROXY_POOL_ENABLED=true`）必须先落地，见 `docs/runbook/deploy-portainer.md` §7.1；T-REL-01 已合入（否则无法复检 disabled 源）。
- **constraints**：
  - **必须先测后改**：在部署 worker 环境跑 `pnpm --filter @fe-radar/worker verify:sources -- --include-disabled`，用生产代理 / robots / 真实 UA / 解析器拿到 ≥3 条真实条目的结论后再写迁移；禁止凭本文档的本机实测结果直接启用（本机结论仅证明"源站活着"，不证明"部署网络能抓到列表条目"）。
  - 重激活门槛沿用既有标准：**smoke 返回 ≥ 3 条**才启用，达不到的保持 disabled 并更新 `last_error` 说明原因。
  - 迁移 `0038` 必须带 admin 保护守卫（参照 `0035` 的 `admin_snapshot ? 'enabled'` 写法），**不覆盖 admin 后台已手工改过的行**。
  - 重激活时必须同时 `fail_count=0, last_error=NULL` —— 系统按 `fail_count>=7` 自动禁用且**不会自动恢复**（见 runbook §7.3），只改 `enabled=true` 会在 7 次失败后再次被打回。
  - 工信部返回的是 WAF JS 挑战页（实测 2116B 脚本页，非内容页），若代理下仍是挑战页，**改走 playwright**（北极星全系 `0011` 已验证此路径可行），不要用 html fetcher 硬抗。
  - 政府站同站请求间隔 ≥ 1s + 真实 UA 轮换（项目陷阱 4）。
- **ask_agent_first**：中国能源报（`paper.people.com.cn` 403）与巨潮（500）是否值得投入 —— 巨潮有公开 JSON 查询接口，走接口比爬 HTML 稳，但需新 adapter；建议本卡先只处理 html/playwright 能覆盖的，巨潮单列。
- **owner**：运维（human）跑复测 → 实现器写迁移。
- **scope**：`packages/db/migrations/0038_*.sql`；如需切 playwright 则含对应 `config` 更新；`spec/source-relevance-fix/verify-report.md`。
- **rollback**：迁移 down = 把本次启用的源改回 `enabled=false`（可逆，无数据破坏）。
- **acceptance**：
  1. 复测报告落盘，每个源标注 HTTP 状态 / 条目数 / 处置决定，**决定与证据一一对应**。
  2. 迁移 0038 幂等（重跑结果一致）且带 admin 保护守卫。
  3. 重激活的源在下一轮抓取后 `items` 中出现新条目，`fail_count` 保持 0。
  4. 未达标的源保持 disabled 且 `last_error` 记录了本次复测的真实失败原因（不是两个月前的旧记录）。

---

## T-REL-03 — 国家能源局改版适配（老 URL 404 → 新栏目 SPA）

> **迁移链兼容**：`0023` 会先把历史 URL 改为 `/xwzx/index.htm`，因此 0039 必须同时匹配 `zyxw.htm` 与 `index.htm`，最终统一切到 `nyyw.htm` + 同源 JSON adapter。

- **goal**：救回 T1 权威源国家能源局。老 URL `www.nea.gov.cn/xwzx/zyxw.htm` 确已 404，新栏目为 `https://www.nea.gov.cn/xwzx/nyyw.htm`（能源要闻）。
- **constraints**：
  - 新版列表页是 **Vue SPA，列表由 JS 渲染**（实测 HTML 仅 3497B，`<li>` 中零 `href`）—— **html fetcher 的 CSS selector 必然抓 0 条**，必须走 `playwright`，或（更优）抓其背后的 JSON 数据接口。
  - 优先探查是否存在稳定 JSON 接口：JSON 比 playwright 省内存、无 BrowserContext 泄漏风险（项目陷阱 2）。若找到则用 html/announcement adapter 直取；找不到再退 playwright。
  - URL 变更走 `UPDATE sources SET url=... WHERE name='国家能源局' AND url='<旧 url>'` 幂等写法（沿用 `0011` B 组模式），**不新增行**（避免重复源）。
  - 抓取合规：先过 `assertRobotsAllowed`。
- **ask_agent_first**：新栏目页的数据接口路径与响应结构（需实际抓包确认）；以及 `xwzx/nyyw.htm`（能源要闻）与 `news/gd.htm`（更多动态）哪个栏目对本项目相关性更高，或两个都收。
- **owner**：实现器。
- **scope**：`packages/db/migrations/0039_*.sql`；若走 playwright 则含 `extractor` 脚本。**不**改 fetcher 框架代码。
- **rollback**：迁移 down 还原 url/config/enabled 为改动前值。
- **acceptance**：
  1. 部署网络 smoke 返回 ≥ 3 条真实新闻标题（不是导航链接）。
  2. 若走 playwright，`extractor` 必须精确选中新闻列表容器，**禁止**用 `document.querySelectorAll('a').slice(0,10)` 这种全页兜底写法（现存"电缆头条"等源的反面教材，产出全是导航噪音）。
  3. 迁移幂等；重跑不产生重复源行。
  4. 抓取后 `items` 有该源条目，且标题人工抽查 ≥ 8/10 是真新闻。

---

## T-REL-04 — CNESA selector 刷新（储能主业直接相关）

- **goal**：中关村储能产业技术联盟（CNESA）实测 **HTTP 200 可达**，当初仅因 `0014` smoke「selector 匹配 0 items」被禁用。刷新 selector 即可救活，是储能主业为数不多的专业协会源。
- **constraints**：
  - 现 config selector 为 `article.et-item` / date `time`（`0014`），需按当前页面结构重新确认。
  - URL 不变 → 走 `UPDATE ... WHERE name AND url` 幂等更新 config，**不用** `INSERT ON CONFLICT`（会因 URL 已存在而静默 no-op，这正是 `0014` A 组当初"改了等于没改"的坑）。
  - 同批可一并处理其它「200 但 selector=0」类源（由 T-REL-01 报告确定名单）。
- **ask_agent_first**：无（标准 selector 修复）。
- **owner**：实现器。
- **scope**：`packages/db/migrations/0040_*.sql`。
- **rollback**：迁移 down 还原 config + `enabled=false`。
- **acceptance**：
  1. smoke ≥ 3 条，标题为真实储能行业资讯。
  2. 迁移用 UPDATE 语义（评审重点核对：**不是** `INSERT ON CONFLICT DO NOTHING`）。
  3. 幂等，重跑结果一致。

---

## T-REL-05 — 死源替换（CWEA / CPIA / 储能网 escn）

> **实施校正（2026-07-27）**：按完整迁移链复核后，`0023` 已将 CPIA 与 escn 从 404 子路径迁移到当前可达首页（live HTTP 200），不得再按旧 URL 结论禁用。0041 仅固化 CWEA 的软禁状态；新增替代源仍需 human 选源后另行实施。

- **goal**：固化 CWEA 因 JS 动态列表不可抓取的软禁状态，同时保留 CPIA / escn 在 `0023` 的首页修复，后续由 human 精选新增垂直源补覆盖缺口。
- **constraints**：
  - CWEA 处置：**软禁不物理删**（`enabled=false` + `last_error` 写明 JS 动态注入原因），避免 FK 风险。
  - CPIA / escn 不得回退到已失效子路径，也不得因旧路径 404 被禁用；部署环境仍需验证 selector 条目数。
  - 新增替代源必须逐个通过：① robots.txt 放行；② 部署网络 smoke ≥ 3 条；③ tier/category 分级理由写进迁移注释。三条缺一不可，**禁止先 seed 后验证**。
  - 新源 seed 用 `INSERT ... ON CONFLICT (url) DO NOTHING`。
  - **候选源不要再选综合门户**，只选与线缆/光纤/储能强相关的垂直源，否则重蹈 R5。可先看 `spec/source-expansion-international/candidates.json` 有无可复用候选。
- **ask_agent_first**：替代源清单需人确认（涉及信源精选这一产品哲学第一条，属 admin 决策而非纯工程）。初步方向：储能可考虑高工储能 / 北极星储能网（已在产出，可加子栏目）；光伏侧因索比受 robots 限制不可用，需另找。
- **owner**：候选清单由 human 拍板 → 实现器写迁移。
- **scope**：`packages/db/migrations/0041_*.sql`。
- **rollback**：迁移 down = 新源 `enabled=false`；CWEA 仅在兼容 adapter 上线后恢复。
- **acceptance**：
  1. CWEA `enabled=false` 且 `last_error` 含动态列表不可解析原因；CPIA / escn 保留 `0023` 当前首页配置。
  2. 每个新增源附 robots 检查结果 + smoke 条目数证据。
  3. 新源全部 seed 后，`sources` 中 category='媒体-垂直' 的 enabled 数量净增。

---

## T-REL-06 — 泛财经 RSS 源补关键词白名单 + 源名正名（成本最低、见效最快）

- **goal**：直接止住截图里"明星投火锅店 / OPPO 分家 / 机器人周报"这类噪音。`0015` 因 RSSHub 垂直路由取不到数据，把三个源降级成了宽口径 feed；`0031` 又因凤凰财经源名不匹配而未命中，四个泛财经源实际都缺少可靠过滤。
- **constraints**：
  - 受影响的 RSSHub 源（均为 `fetcher_type='rss'`）：
    - `36氪 新能源` → 实抓 `/36kr/information/web_news`（全站快讯）
    - `第一财经 能源` → 实抓 `/yicai/headline`（全站头条）
    - `界面新闻 能源` → 实抓 `/jiemian/lists/856`（需确认是否为能源垂直栏目，若是则词表可放宽）
  - **实施校正**：`0031` 使用了不存在的名称 `凤凰财经-能源`，实际 seed 为 HTML 类型的 `凤凰财经 能源`。本卡同步让 HTML 支持同一 pre-dedup `keywordFilter`，并覆盖两个历史名称。
  - 词表**复用 `0031` 已验证的那份**（电力/电网/电缆/电线/输配电/特高压/变压器/储能/能源/光伏/风电/新能源/锂电/锂电池/碳酸锂/铜/有色/稀土/充电桩/电池/电工/远东），并**追加 T-REL-07 的光纤词**，保持全项目一份词表口径。
  - 幂等守卫沿用 `0031`：`WHERE name=... AND (config->'keywordFilter') IS NULL`，仅首次写入，不覆盖 admin 改动。
  - **源名正名**：把 `36氪 新能源` → `36氪 快讯（全站）`、`第一财经 能源` → `第一财经 头条（全站）`，让 admin 后台一眼看出这是宽口径源。名称变更不影响 `url` 主键，无副作用。
  - 关键词过滤在 **pre-dedup** 位置执行（`fetch.ts` rawItems 之后、candidates 之前）；RSS 已实现，HTML 复用同一逻辑。
- **ask_agent_first**：词表命中是「标题+正文」还是「仅标题」—— 现实现是标题+正文（`fix-industry-filter.md` Fix-3），正文含"铜"字的泛财经文章可能仍漏过。建议本卡先不改逻辑，用 T-REL-00 基线跑一周后再评估是否收窄为仅标题。
- **owner**：实现器。
- **scope**：`packages/db/migrations/0042_*.sql`、`apps/worker/src/fetchers/types.ts`、`apps/worker/src/handlers/fetch.ts`、Web source config schema。
- **rollback**：迁移 down 移除 `keywordFilter` 键 + 还原名称。
- **acceptance**：
  1. 四个源 config 均含 `keywordFilter`，且幂等守卫存在（评审逐字核对 `IS NULL` 条件）。
  2. 迁移后一轮抓取，人工抽查这些源的 20 条产出，**无产业无关条目**（对照 T-REL-00 基线）。
  3. admin 后台源列表中**两个**宽口径源（`36氪 快讯（全站）`、`第一财经 头条（全站）`）名称已能反映真实抓取口径。（`界面新闻 能源` 确认为能源垂直栏目、只加词表不改名；`凤凰财经 能源` 仅把 `0031` 写错的历史名 `凤凰财经-能源` 归一，不属口径正名。）
  4. 幂等，重跑不覆盖。

---

## T-REL-07 — 光纤 / 光缆主业覆盖补齐（当前为零）

- **goal**：远东三大主业中**光纤在系统里完全没有表示**——全仓库 grep「光纤/光缆」零命中（除 C2 实体名亨通光电/中天科技外），prefilter prompt、关键词表、信源 seed 全无覆盖。这意味着光纤相关情报**从抓取到评分全链路系统性漏报**。
- **constraints**：
  - **三处同步补齐，缺一处即无效**：
    1. `packages/llm/src/prompts/prefilter.ts` 的 `PREFILTER_SYSTEM_PROMPT` 判定范围补「光纤、光缆、光通信」。
    2. `keywordFilter` 词表（T-REL-06 那份）追加「光纤/光缆/光通信/光模块/OPGW/ADSS」。
    3. 新增光纤垂直信源（候选方向：C114 通信网、光纤在线、讯石光通讯网 —— 需逐个验 robots + smoke）。
  - **同时收窄 prompt 边界**（本卡顺带修 R6 的另一面）：现 prompt 含「产业链公司」这一模糊表述，本地 Qwen 小模型据此把「机器人硬科技投资」「AI 手机厂商」判为相关。建议改为**正例枚举 + 反例排除**双向约束，明确排除「消费电子 / 互联网 / 泛科技投融资，除非直接涉及电力电缆光纤储能供应链」。
  - **prompt 改动必须有回归证据**：`apps/worker/src/jobs/__tests__/prefilter.samples.test.ts` 已有样例测试，必须补入本次的真实反例（截图三条）与光纤正例，改 prompt 前后跑同一组样例对比。
  - LLM 调用仍必经 `withScrubber`（已在 `handlers/prefilter.ts` 接线，不得绕过）。
- **ask_agent_first**：① prompt 收窄后是否会误杀原本正确的边缘条目 —— 需用 T-REL-00 抽取的历史真实条目做 A/B 回归，不能只靠构造样例；② 光纤信源候选清单需 human 拍板（同 T-REL-05，属信源精选决策）。
- **owner**：prompt + 词表由实现器；信源清单由 human 拍板。
- **scope**：`packages/llm/src/prompts/prefilter.ts`、`apps/worker/src/jobs/__tests__/prefilter.samples.test.ts`、`packages/db/migrations/0043_*.sql`。
- **rollback**：还原 prompt 文件（无状态，立即生效）；迁移 down 移除新源与新词。
- **acceptance**：
  1. 样例测试含 ≥ 3 条光纤正例（判 true）与截图三条反例（判 false），全部通过。
  2. 用 ≥ 50 条历史真实条目做 A/B：新 prompt 的产业相关召回**不低于**旧 prompt，精确率提升（数字落盘）。
  3. 新增光纤源 smoke ≥ 3 条 + robots 放行证据。
  4. `pnpm -r test` 全绿。

---

## T-REL-08 — 收紧告警豁免通道（堵住 NER 误报「保送」）

- **前置**：**T-REL-00 第 4 项数据出来后再启动**。若查得 `alert_type='safety' AND is_industry_related=false` 计数为 0，本卡降级为 P2 预防性加固，不占本批次资源。
- **goal**：截图中「机器人周报」「OPPO 分家」两条都挂着**安全事故**徽章。safety 告警条件是 NER 标出 `event_type=事故` 且 D5≥70（`packages/core/src/alert.ts:62`），两者都是 LLM 输出；一旦误报，该条目凭 `alertType IS NOT NULL` **无条件豁免**行业闸门（`timeline-query.ts:188`）直接上线。更严重的是告警条目还会进告警页与钉钉推送，噪音影响大于时间线。
- **constraints**：
  - **硬约束**：`alert_type` 触发必须统一在 `packages/core/alert.ts:computeAlert()` 单一入口 —— 因此修复**做在 computeAlert 内**（给 safety 分支加护栏），**不要**去 `timeline-query.ts` 改豁免条件绕过单一入口。
  - **必须守住「自家公司零漏报」**：`own` / `legal` / `risk` 三类告警是实体驱动（远东同义词 / C2 竞品圈层 / 企业风险源），可靠性高，**一律不得收紧**。本卡只动 `safety`。
  - 推荐规则（待 ask_agent_first 定稿）：safety 触发在现有「`event_type=事故` + D5≥70」基础上**追加要求命中至少一个产业实体**（company / product / region 类 NER 命中），纯事件类型单独命中不足以触发。理由：真实产业安全事故必然伴随企业或产品实体。
  - `computeAlert` 是 `packages/core` 纯函数，**不得依赖 `packages/db`**（模块边界硬约束）；所需实体命中信息已在 `AlertInput.entities` 中，无需新增依赖。
  - 判定顺序不得改动（own → 风险检索 → legal → risk → safety → policy，`0713` 对抗评审 Finding #5 已修正过一次，勿回退）。
- **ask_agent_first**：护栏的确切形式 —— ① 要求同时命中产业实体（推荐）；② 要求 `topCircle IN ('C1','C2')`（更严，但会漏掉 C3 圈层的真实行业事故）；③ 提高 D5 阈值（治标，不解决 NER 误报）。需结合 T-REL-00 第 4 项的真实数据分布决策。
- **owner**：实现器（核心逻辑，风险较高 → 建议 codex）。
- **scope**：`packages/core/src/alert.ts`、`packages/core/src/__tests__/alert.test.ts`。**不**改 web 查询层、**不**改其它告警分支。
- **rollback**：还原 `alert.ts`（纯函数，无迁移无状态）。
- **acceptance**：
  1. 单测覆盖：① 真实产业事故（事故 + 企业实体 + D5≥70）**仍触发** safety；② 纯事件误报（事故 + 零产业实体）**不再触发**；③ own/legal/risk 三分支行为**逐字节不变**（回归断言）；④ 判定顺序回归用例保留。
  2. 用 T-REL-00 导出的历史 safety 告警条目回放，人工确认**无真实事故被误杀**（这是零漏报底线，必须有证据不能只跑单测）。
  3. `pnpm --filter @fe-radar/core test` 全绿；`pnpm -r typecheck` 0 error。

---

## 不在本期范围（登记为后续 issue，避免范围蔓延）

- **`pickTopCircle` 的 C3 兜底语义**：`packages/core/src/scoring.ts:81-90` reduce 初始值为 `"C3"`，无任何实体命中时也标 C3，导致「无命中」与「真 C3 行业面」不可区分，C3 徽章基本无信息量。`fix-industry-filter.md` 已显式记录为本期外，跨 core/db/ui 三层，单列。
- **NER 召回缺口**：若 NER 漏掉真实 C1 实体，条目退化为 C3，叠加 prefilter 判 false 即被隐藏（`fix-industry-filter.md` 已登记的残余风险）。T-REL-07 补词表能部分缓解，根治需单独做 NER 评测集。
- **巨潮 JSON 接口 adapter**：见 T-REL-02 ask_agent_first，需新 fetcher 类型，单列。
- **电缆网 cableabc / 中电联 TLS 失败**：本机直连仍失败，但测试链路仍经代理隧道，结论不可信；留待 T-REL-02 在部署内网复测后再定生死。`0025` 已给 cableabc 配过 `insecureTLS`，需确认是否生效。

## 全局完成判据（Standard）

1. T-REL-00 基线数据先落盘，后续卡的验收**对照基线量化**（不接受"感觉好多了"）。
2. 主会话 + 独立评审者双双 APPROVE。
3. `pnpm -r typecheck` 0 error + `pnpm -r test` 全绿。
4. 每张卡 acceptance 逐条满足，证据落 `spec/source-relevance-fix/`（阻塞登记与基线；verify 报告等同目录）。
5. 合规红线无违反（**索比 / 雪球 / 搜狗微信仍禁用**、无原始 HTML 存储、代理不绕 robots、scrubber 未绕过）。
6. 迁移 0038–0043 全部幂等且带 admin 保护守卫。
7. 产物标 `needs_human_review`，运维项交 human 落地。
