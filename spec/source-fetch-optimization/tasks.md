# 信源抓取优化 — 任务卡 (source-fetch-optimization)

> 来源:对 Grok 信源优化建议的代码级可行性复核(2026-06-17)。核心结论 = **不缺架构,缺通电** + 监控由表格升级为流程视图。
> 模式:Standard(跨 worker/db/web-api/web-ui,单/多 agent 并行,低-中风险)。
> 评审门槛:typecheck + tests 全绿;mimo 代码评审 APPROVE;主会话复审通过。
> AI 产出标 `needs_human_review`,不得宣称可直接上线。

## 范围总览

| 卡           | 主题                                                         | 类型          | scope                                                                                                  | owner                    |
| ------------ | ------------------------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------ |
| T-SRC-01     | P0 住宅代理 + Firecrawl key 上线文档                         | **仅文档**    | `docs/runbook/**` `handoff.md`                                                                         | 文档(主会话写)→ 运维落地 |
| ~~T-SRC-02~~ | _(reserved/removed — P0 两项合并进 T-SRC-01,编号跳过非漏卡)_ | —             | —                                                                                                      | —                        |
| T-SRC-03     | P1-③ per-source opt-in insecureTLS + 删死源                  | 代码          | `apps/worker/src/fetchers/http.ts` `apps/worker/src/fetchers/types.ts` `packages/db/migrations/0025_*` | 实现器                   |
| T-SRC-04     | P1-④ 信源管理页 KPI 接线                                     | 代码(web)     | `apps/web/app/(admin)/admin/sources/source-table.tsx` + 1 个聚合查询                                   | 实现器                   |
| T-SRC-05     | 流程视图:聚合查询 + API                                      | 代码(web-api) | `apps/web/lib/api/pipeline-flow-query.ts` `apps/web/app/api/admin/pipeline-flow/route.ts`              | 实现器                   |
| T-SRC-06     | 流程视图:UI 组件 + 置顶布局                                  | 代码(web-ui)  | `apps/web/components/worker/pipeline-flow.tsx` + worker-monitor 装配                                   | 实现器                   |

## 合规红线(全卡通用,违反 = 评审驳回)

- 代理池**仅绕 IP 封禁,不得绕 robots.txt**;雪球 / 搜狗微信(电缆头条·储能头条)/ 索比光伏 **保持禁用**,本批次不得改动其 enabled 或绕过 `assertRobotsAllowed`。
- **不存原始 HTML 快照**(FR-12)。
- 公网 LLM 调用前必经 `packages/core/scrubber.ts`(本批次不新增 LLM 调用,保持)。
- TZ=Asia/Shanghai,时间一律 `dayjs().tz()`,禁 `new Date().toLocaleString()`。
- 配置存 DB,不硬编码;seed `ON CONFLICT DO NOTHING`,死源处理走新迁移 0025,不改旧迁移。
- commit message:`[T-SRC-0X] 动词 + 范围`。

## 待人确认的潜在问题(codex 复核发现,本批次不修,记录待办)

- **`quotaState` 死信号**:`fetch.ts:111` 以 `'admitted'` 初始化后,全库无任何代码写非 admitted 值(`pending_over_quota`/`dropped_*` 仅存在于 schema CHECK)。意味着限速器/quota 落库可能未接通 item_analysis,或该列已废弃。**不在本批次范围**,但建议作为独立 issue 复核 `packages/core/quota.ts` 与 prefilter/scorer 的 quotaState 落库链路。本批次仅确保流程视图**不依赖**该列。

---

## T-SRC-01 — P0 住宅代理 + Firecrawl key 上线文档

- **goal**:把两项「零代码、纯运维」上线动作写成可执行 runbook + handoff 行,运维据此在 Portainer 落地。**不写脚本、不改代码**(用户决定)。
- **constraints**:
  - 文档只描述**已有**能力如何通电,不声称代码改动。代理基建见 `apps/worker/src/lib/proxy-pool.ts`(env `PROXY_POOL_ENABLED`/`PROXY_LIST_FILE`);Firecrawl 见 `apps/worker/src/fetchers/crawl/firecrawl-client.ts`(env `FIRECRAWL_API_KEY`)+ 迁移 0024 已 enable 源 `Firecrawl-C1风险检索`。
  - 明确合规:代理仅用于绕机房 IP 封禁(发改委/工信部/中电联/中国能源报 paper.people 403 簇),**不得**用于 robots 禁用源。
- **ask_agent_first**:无(文档卡)。
- **owner**:文档由主会话写;落地由运维(human)。
- **scope**:`docs/runbook/deploy-portainer.md` 新增「§X 信源能力通电(住宅代理 / Firecrawl)」一节;`handoff.md` Human Action Required 增两行。
- **rollback**:删除新增文档小节即可,无运行时影响。
- **acceptance**:
  1. runbook 含:① 采购住宅代理 → `docker secret create proxy_list` → stack env `PROXY_POOL_ENABLED=true` → 重部署 worker → 验证发改委等 403 源 `fail_count` 归零;② `docker secret create firecrawl_api_key` → 确认 `Firecrawl-C1风险检索` enabled → 跑一轮 → `items` 出现 crawl 来源条目。
  2. 每步含**验收 SQL/命令**与 **rollback**(关 env / 关 source.enabled)。
  3. 标注合规边界(代理不绕 robots)。

---

## T-SRC-03 — P1-③ per-source opt-in insecureTLS + 删死源

- **goal**:① 给 `fetchTextWithPolicy` 加**按源可选**的宽松 TLS 开关,救 TLS 握手失败的电缆网 cableabc(**html 类**);② 迁移删/禁死源 china-power(域名 404)+ backfill cableabc 配置。
- **范围澄清(codex round-2)**:智能电网在线是 **playwright 类型**(SSL 失败),html `insecureTLS` 不覆盖它 → **本卡不处理 smartgrid**,保持禁用(playwright TLS 是 `ignoreHTTPSErrors`,另案)。本卡只救 html 类的 cableabc。
- **constraints**:
  - **默认仍严格校验证书**;宽松仅在 source.config 显式 `insecureTLS: true` 时对该次请求生效(undici `Agent`/`ProxyAgent` 的 `connect.rejectUnauthorized:false`)。不得全局关闭。
  - 与现有 proxy `dispatcher` 逻辑兼容:有代理时也要能叠加宽松 TLS(ProxyAgent 的 `requestTls.rejectUnauthorized`)。
  - 宽松 TLS 命中时打一条结构化 warn 日志(source + url),便于审计。
  - **类型透传链**:`HtmlSourceConfig` 增可选 `insecureTLS?: boolean`(types.ts);`FetchTextOptions` 增 `insecureTLS?: boolean`(http.ts);`fetchHtml` 读 `config.insecureTLS` 塞进 options;`http.ts` 据此构造放宽 TLS dispatcher。**handler 无需改**(config 经 switch 直传 fetchHtml)。
  - **持久化链(codex B3:admin 经 API 存不进去)**:`apps/web/lib/api/sources-schema.ts` 的 html discriminated-union 变体增 `insecureTLS: z.boolean().optional()`,否则 sources API 校验会丢弃该字段。
  - 迁移 `0025_*`:① `UPDATE sources SET enabled=false, last_error='china-power.com.cn 域名 404 下线' WHERE ...`(软禁死源,不物理删);② cableabc backfill:`config = jsonb_set(config,'{insecureTLS}','true')` + `enabled=true, fail_count=0, last_error=NULL`(一次性显式修复,非 seed)。**不**碰其它源。
- **ask_agent_first**:undici `Agent` vs `ProxyAgent` 同时支持自定义 TLS 的正确写法(`connect.rejectUnauthorized` / `requestTls.rejectUnauthorized`),避免与现有 dispatcher 冲突。
- **owner**:实现器(核心/难点 → codex)。
- **scope**:`apps/worker/src/fetchers/http.ts`、`apps/worker/src/fetchers/html.ts`、`apps/worker/src/fetchers/types.ts`、`apps/web/lib/api/sources-schema.ts`、`packages/db/migrations/0025_*.sql`。**不**改 handler、**不**改 playwright 路径。
- **rollback**:还原 http.ts/html.ts/types.ts/sources-schema.ts;迁移 down = china-power `enabled=true` + cableabc 回退 config/enabled(可逆)。
- **acceptance**:
  1. 不带 `insecureTLS` 的源行为零变化(回归);cableabc 带 `insecureTLS:true` 时可取回 HTML。
  2. 单测**逐一覆盖四种 dispatcher 组合**:① 无代理+insecureTLS、② 代理+insecureTLS、③ 仅代理(无 insecureTLS,严格 TLS)、④ baseline(无代理无 insecureTLS,严格 TLS)。
  3. sources-schema.ts:html config 带 `insecureTLS:true` 通过校验且不被剥离(增断言)。
  4. migration 0025 幂等(重跑不报错);cableabc config 出现 `insecureTLS:true`。
  5. typecheck 0 error;`pnpm -r test` 全绿。

---

## T-SRC-04 — P1-④ 信源管理页 KPI 接线

- **goal**:把 `source-table.tsx` KPI 条的 `"—"` 占位接到**现成** `/api/admin/source-health`;表格补 health 状态/最近错误列。**KPI 条均为全局汇总(非 per-source)**:近 24h 抓取量 = 全局总计数、下次抓取 = 最近一个、成功率 = 全局口径。
- **constraints**:
  - **数据获取(codex 复核:`SourceTable` 当前无 props、只自取 `/api/sources`,其 `SourceRow` 不含 health/lastError/nextFetch)**:`source-table.tsx` 增加第二次客户端拉取 `/api/admin/source-health`,按 `id` 与现有 `/api/sources` 行 **merge**,取得 health/staleHours/nextFetch/lastError。复用现成 `lib/api/source-health-query.ts`,**不重复造聚合**。
  - 「近 24h 抓取量」= `items` 按 `fetchedAt >= now()-24h` 计数(items 有 `sourceId`+`fetchedAt`,**不需新表**)。实现为在 `source-health-query.ts` 的 payload **summary 增一个聚合字段** `fetched24h`(单次聚合查询),前端直接读,避免再开 endpoint。
  - 「下次抓取」取 health 行已算好的 `nextFetchIso` 的最近一个。
  - 成功率口径与 worker-monitor 的 health summary 一致(healthy/(total-disabled)),避免两处不同口径。**KPI 标签从「近 7 天成功率」改为「当前健康率」**(口径是 health 快照,非 7 天滚动,旧标签会误导)。
  - 保持 `rounded-none` / 字体 / 配色等现有设计 token,不引新样式体系。
- **ask_agent_first**:merge 时机(两 fetch 并行 `Promise.allSettled` 后 join,单侧失败不白屏,沿用 worker-monitor 的 per-panel error 模式)。
- **owner**:实现器(标准 → GLM/pi)。
- **scope**:`apps/web/app/(admin)/admin/sources/source-table.tsx`、`apps/web/lib/api/source-health-query.ts`(summary 加 `fetched24h` 聚合,含 mock 分支)。`/api/admin/source-health/route.ts` 无需改(payload 透传)。**不**动 worker-monitor。
- **rollback**:还原 source-table.tsx(及 query)即恢复占位。
- **acceptance**:
  1. 四个 KPI 全部有真实值(无 `"—"` 占位,除非真无数据);mock 模式下也有合理值。
  2. 表格行展示 health 徽章 + 失败时最近错误。
  3. **成功率公式与 worker-monitor health summary 一致(`healthy/(total-disabled)`),有 fixture 单测验证**(防回退旧 `failCount<3` 口径)。
  4. 现有 `admin-sources.spec.ts` 不回归;为新 KPI 增断言。
  5. typecheck 0 error;web 包 test 绿。

---

## T-SRC-05 — 流程视图:聚合查询 + API(方案 A 派生漏斗)

- **goal**:提供「7 节点 + 每节点 per 信源派生推进状态」的聚合数据,供流程图渲染。**web-only,零 DB 迁移、零 worker 改动**。
- **constraints**:
  - 节点链固定:`fetch → prefilter → ner → scorer → embedder → cluster → curator`。
  - **⚠️ 单调阶梯派生(codex 复核后的修订口径,务必照此实现,否则 prefilter/ner 系统性误判红灯):**
    - 管线**严格顺序**,故"到达某 reliable 标记 ⇒ 之前所有阶段都已通过"。先对每个 item 算"已到达的最远阶段",再 per 阶段判 green = item 到达 ≥ 该阶段。
    - **reliable 单调标记(codex round-2 复核:务必用各阶段 handler 真正落库的列,不要望文生义)**:
      - prefilter-done = `item_analysis.isIndustryRelated IS NOT NULL`(**不是**"行存在"——行在 fetch 阶段即插入且 `isIndustryRelated=null/quotaState='admitted'`,见 fetch.ts:111;`quotaState` 全库无写非 admitted 的代码,**禁止用作信号**)。
      - scorer-done = `item_analysis.d1Policy IS NOT NULL`(scorer.ts:26 写 d1Policy/d2-d5;**不是 scoredAt**)。
      - embedder-done = `item_analysis.embedding IS NOT NULL`(embedder.ts:26)。
      - cluster-done = 存在 `cluster_items` 成员(cluster.ts)。
      - curator-done = `item_analysis.scoredAt IS NOT NULL`(**curator.ts:80 在末阶段 stamp scoredAt**;**不是 isCurated**——`isCurated` 是"是否入选精选"的子集结果,默认 false 且合法,用它会把已跑完 curator 但未精选的 item 误判未推进)。
    - **ner 无自有 reliable 标记**(无命中实体的 item 合法写 0 行 item_entities,见 ner.ts:32,与"未到 NER"不可区分)。故 **ner-done = scorer-done(d1Policy 非空) OR (存在 item_entities 行)**;**空 item_entities 绝不判红**(顺序管线 prefilter<ner<scorer,d1Policy 非空即证 NER 已跑过)。
    - fetch-done:取 source-health 口径(`sources.lastOkAt/failCount`),非 item 派生。
    - **阶段顺序(已核)**:fetch → prefilter → ner → scorer(d1Policy) → embedder(embedding) → cluster(cluster_items) → curator(scoredAt)。每个标记非空 ⇒ 其之前所有阶段都已过。
  - **分母处理(漏斗自然收窄,避免把合法过滤判红)**:被 prefilter 过滤的 item(`isIndustryRelated = false`)是**终态合法退出**,在 ner 及之后节点计为 **grey/filtered**,并**从下游分母剔除**。即:prefilter 节点分母 = 该源近 24h 全部 item;ner 及之后节点分母 = 通过 prefilter(`isIndustryRelated = true`)的 item。
  - per 信源**灯色规则**(每节点,分母如上):green = 到达 ≥ 此阶段占比 ≥ `THRESHOLD_GREEN`;yellow = `0 < 占比 < THRESHOLD_GREEN`;red = 占比 = 0(真卡在此阶段前)或(仅 fetch 节点)source-health=failing;grey = 分母为 0(该源近 24h 无 item / 全被过滤 / disabled)。
  - **阈值为命名常量**:`export const THRESHOLD_GREEN = 0.6`(在 `pipeline-flow-query.ts`),单测须覆盖两侧边界(0.59→yellow,0.60→green)。
  - **红灯语义 = "items 未推进到此",非"此阶段对该源报错"**(item 级阶段错误无埋点,方案 A 限制,UI 文案需如实标注)。
  - 节点**汇总状态**复用 `/api/admin/worker` 的 BullMQ 队列计数(不重复查 Redis;前端可合并两 API,或本 API 仅返回 per-source 矩阵,节点级沿用 worker API)。**倾向**:本 API 只返回 `{ stages: [...], sources: [{id,name,tier, perStage: {fetch:'green',...}}] }` 派生矩阵,节点级 BullMQ 状态由前端复用已有 worker 数据。
  - 性能:单次聚合查询(或少量),避免 N+1;`force-dynamic` 不缓存。
  - mock 模式提供可信样例(对齐 worker-monitor mock 风格)。
- **ask_agent_first**:用一条 SQL(items LEFT JOIN item_analysis / item_entities / cluster_items + group by source, stage)还是分阶段聚合再装配;确认 90 天保留窗口对 24h 窗口无影响。
- **owner**:实现器(核心 → codex,因聚合 SQL 是难点)。
- **scope**:`apps/web/lib/api/pipeline-flow-query.ts`、`apps/web/app/api/admin/pipeline-flow/route.ts`、`apps/web/lib/api/__tests__/pipeline-flow-query.test.ts`。**不**改 schema、worker。
- **rollback**:删除新增文件 + 前端引用。
- **acceptance**:
  1. API 返回 7 节点 × 各信源的派生灯色矩阵,标记列严格用 isIndustryRelated/d1Policy/embedding/cluster_items/scoredAt(curator)+ ner 兜底,口径与上方一致。
  2. 单测(`pipeline-flow-query.test.ts`)覆盖:① 单调阶梯(scoredAt 非空的零实体 item → ner=green 不假红);② curator-done 用 scoredAt 而非 isCurated(isCurated=false 但 scoredAt 非空 → curator=green);③ prefilter 过滤项不计下游分母(grey);④ 阈值边界 0.59→yellow / 0.60→green。
  3. 单次/少量查询完成,无 N+1;mock 模式可用。
  4. typecheck + test 绿。

---

## T-SRC-06 — 流程视图:UI 组件 + 置顶布局

- **goal**:在运行监控页**置顶**渲染 7 节点横向流程图;节点显示完成/进行中/失败(复用 BullMQ 队列计数);点击/展开节点显示其下各信源红绿灯(取 T-SRC-05 矩阵)。现有心跳/队列/信源健康三表**下沉**为下钻明细(可折叠),不删除。
- **constraints**:
  - 复用现有设计 token(`rounded-none`、`text-ok/warn/danger/fg-soft`、`font-mono`、`shadow-card`);灯色映射对齐 worker-monitor 的 `HEALTH_BADGE`(green→ok, yellow→warn, red→danger, grey→fg-soft)。
  - 10s 轮询沿用 `REFRESH_MS`;新数据并入现有 `Promise.allSettled` 多源加载,**单面板失败不拖垮其它**(沿用现有 per-panel error 模式)。
  - 节点链与 T-SRC-05 stages 顺序一致;无障碍:灯色附文字/title,不只靠颜色。
  - 不引入图形库(无 d3/reactflow);用 CSS/flex 画节点 + 连线(→),保持轻量。
  - TZ 一律 `dayjs().tz()`。
- **ask_agent_first**:置顶流程图与三表的折叠交互(默认展开流程图,表格默认收起还是保留)。倾向:流程图默认展开置顶;队列/信源健康表保留展开(信息密度高),仅作视觉下沉。
- **owner**:实现器(标准 → GLM/pi;UI 也可 Grok surge 并行)。
- **scope**:新增 `apps/web/components/worker/pipeline-flow.tsx`;改 `apps/web/components/worker/worker-monitor.tsx`(装配置顶 + 接 pipeline-flow API)。
- **rollback**:还原 worker-monitor.tsx;删 pipeline-flow.tsx。
- **acceptance**:
  1. 运行监控页顶部出现 7 节点流程图,节点反映 BullMQ 状态;展开节点见各信源红绿灯,与 T-SRC-05 一致。
  2. 现有三表仍可见(下沉),功能不回归。
  3. 灯色有文字/title 辅助(无障碍)。
  4. **pipeline-flow API 拉取失败时:流程图区域显示静音内联错误 + 重试按钮,下方三表仍正常可用(不白屏)**(沿用 worker-monitor per-panel error 模式)。
  5. 既有 worker-monitor 相关 e2e/单测不回归,新增流程图渲染断言。
  6. typecheck + web test 绿。

---

## 全局完成判据(Standard)

1. 主会话 + mimo 双双代码评审 APPROVE;
2. `pnpm -r typecheck`(或等价)0 error + `pnpm -r test` 全绿;
3. 每张卡 acceptance 逐条满足;
4. 合规红线无违反(robots 禁用源未动、无原始 HTML 存储、TLS 默认严格);
5. 产物标 `needs_human_review`,P0 文档交运维落地。
