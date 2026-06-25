# FE-Radar v1.2 — 火山方舟 Agent Plan Harness 接入 Tasks (v0.2)

> **状态**：Draft v0.2（spec review 7 findings 已闭合）· 与 `requirements.md` v0.1 / `design.md` v0.1 配对
> **基础依赖**：v1.0 `spec/tasks.md` v0.3（M0–M5 全部 Done）+ v1.1 commodity-briefing（V11-P1..P3 已交付）+ `.ai/shared/style-invariants.md` v1.0
> **模式**：Full（跨 packages/db + packages/core + packages/shared + apps/worker + deploy，高风险，核心管线变更）
> **作者**：Codex（Plan Stage 产出）
> **格式**：每条 task 遵循 `.ai/shared/task-template.md`（goal / constraints / ask_agent_first / owner / scope / rollback / acceptance）
> **commit message**：`[T-ARK-XX] 动词 + 范围`；可选尾缀 Linear 引用 `(DMA-XX)`
> **v0.1 → v0.2 修复点**（spec review REQUEST_CHANGES → 7 findings 全闭合）：
>
> - **F1 CRITICAL**：T-ARK-04/15 client secret 注入改用 readEnvOrSecretFile 模式（ENV + \*\_FILE 双通道，照搬 firecrawl-client.ts:14）
> - **F2 CRITICAL**：T-ARK-05 dataPro adapter 错误语义从"失败返回[]"改为 throw（走通用 fetch handler，空结果会被 markSourceSuccess）；T-ARK-15 websearch 保留返回[]（有独立 job handler）
> - **F3 MAJOR**：T-ARK-07 alert 分支修正 — C1 已被首分支捕获，新分支只处理 C2（无 C1）→ risk/L2
> - **F4 MAJOR**：Phase 依赖声明修正 — P2 依赖 P1 基础 migration(T-ARK-01) + stack(T-ARK-10)
> - **F5 MAJOR**：创建 requirements.md v0.1 + design.md v0.1 闭合 Full mode 闭环
> - **F6 MEDIUM**：T-ARK-08 computeD3Market 返回 `number | null`（null = 无数据不覆盖），T-ARK-09 仅非 null 时覆盖
> - **F7 MEDIUM**：T-ARK-02 seed config maxItemsPerQuery:5 → maxStocksPerQuery:3（对齐 dataPro 限制）

---

## 0. 背景与现状诊断

FE-Radar 当前数据来源依赖 HTML/RSS 爬取 + Firecrawl 通用爬虫 + 交易所公告适配器，存在以下数据盲区：

| #   | 盲区                          | 当前实现                                                               | 位置                                                                                                                                                                                        |
| --- | ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | C2 竞对上市公司财务监测为空白 | `entities.meta` 仅存 `stockCode`（migration 0019），无财务指标时序数据 | [schema.ts:49-61](file:///Volumes/SD/AI-Timeline-web/packages/db/src/schema.ts#L49-L61)                                                                                                     |
| 2   | 企业风险检索依赖关键词匹配    | `isRelevantRiskResult` 纯字符串 `includes` 匹配，准确率低              | [risk-search.ts:15-22](file:///Volumes/SD/AI-Timeline-web/packages/core/src/risk-search.ts#L15-L22)                                                                                         |
| 3   | 上市公司涉诉仅靠公告抓取      | `cninfo/szse/sse` 三家交易所公告，覆盖面窄                             | [litigation.ts](file:///Volumes/SD/AI-Timeline-web/packages/core/src/litigation.ts) + [fetchers/announcements/](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/fetchers/announcements/) |
| 4   | Firecrawl 中文网页覆盖不足    | crawl adapter 依赖 Firecrawl search，国内行业覆盖弱                    | [firecrawl-adapter.ts](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/fetchers/crawl/firecrawl-adapter.ts)                                                                              |

**已开通的火山方舟 Agent Plan Harness**（两个 MCP）：

1. **专业数据集（dataPro-search）** — HTTP MCP
   - URL：`https://datapro.hqd.cn-beijing.volces.com/mcp`
   - 鉴权：Header `X-Agent-Plan-Key: <API Key>`
   - 工具名：`dataPro_search`，入参 `{ "query": "自然语言查询" }`
   - 支持数据类型（自动路由）：金融数据库（60+ 财务指标）/ 企业工商数据库 / 企业风险数据库（司法诉讼/行政处罚/失信/经营异常）/ 科研学术数据
   - 返回格式：结构化 JSON，含 `items[].table` 键值对（精确数值）
   - 调用限制：单次查询最多 3 只股票 / 5 家公司 / 50 篇论文（config.maxStocksPerQuery 默认 3）
   - 计费：消耗套餐 AFP 额度

2. **豆包搜索（web_search）** — **直连 HTTP REST**（已确认，不用 uvx）
   - URL：`https://open.feedcoopapi.com/search_api/web_search`（API Key 接入，推荐）
   - 鉴权：Header `Authorization: Bearer <API Key>`
   - 入参：`{ "Query": "搜索词", "SearchType": "web", "Count": 10, "TimeRange": "OneDay|OneWeek|OneMonth|OneYear", "Filter": { "AuthInfoLevel": 0 } }`
   - 返回格式：`Result.WebResults[]`，每项含 `Title` / `SiteName` / `Url` / `Snippet` / `Summary` / `Content` / `PublishTime` / `AuthInfoLevel`
   - 免费额度：每账号每月 500 次（与 Global 版共用）
   - 限流：账号维度默认 5 QPS
   - 官方文档：[volcengine.com/docs/87772/2272953](https://www.volcengine.com/docs/87772/2272953)

> **关键决策（已确认）**：
>
> 1. 财务数据用新表 `entity_financials`（不用 `entities.meta`，因 meta 是单 jsonb 无法存时序）
> 2. 豆包搜索用直连 HTTP REST（`open.feedcoopapi.com`），不用 uvx 子进程 — 消除了原方案最脆弱假设

---

## 1. 架构关键事实（实施前必读）

| 事实                                                                                                        | 位置                                                                                                                                                                                          | 影响                                  |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- | --------------------------------------------------------------------------------------- | ------------- |
| Pipeline 执行顺序 `prefilter → ner → scorer → embedder → cluster → curator`（BullMQ FlowProducer 子先于父） | [flows.ts:5-37](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/flows.ts#L5-L37)                                                                                                           | **NER 是事件驱动 websearch 的触发点** |
| fetch 分发是 `switch(config.type)`                                                                          | [fetch.ts:47-68](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/handlers/fetch.ts#L47-L68)                                                                                                | 新增 fetcher 类型在此加 case          |
| adapter 注册模式两套范本：crawl + quotes                                                                    | [crawl/index.ts](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/fetchers/crawl/index.ts) / [quotes/index.ts](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/fetchers/quotes/index.ts) | 新 fetcher 照搬                       |
| `items.url` 有 UNIQUE 约束                                                                                  | [schema.ts:66](file:///Volumes/SD/AI-Timeline-web/packages/db/src/schema.ts#L66)                                                                                                              | dataPro 结构化结果需合成确定性 URL    |
| `computeAlert()` 是告警单一入口                                                                             | [alert.ts:10](file:///Volumes/SD/AI-Timeline-web/packages/core/src/alert.ts#L10)                                                                                                              | 新增 '企业风险' 分支必须在此          |
| 当前 AlertType = `"own"                                                                                     | "safety"                                                                                                                                                                                      | "policy"                              | "legal"` | [shared/types.ts:6](file:///Volumes/SD/AI-Timeline-web/packages/shared/src/types.ts#L6) | 需加 `"risk"` |
| quota.ts `ADMIT_LUA` 是原子 incr+expire                                                                     | [quota.ts:6-16](file:///Volumes/SD/AI-Timeline-web/packages/core/src/quota.ts#L6-L16)                                                                                                         | 复用于 websearch 月度计数器           |
| 管线所有 LLM 调用点已用 `withScrubber` 包裹                                                                 | [ner.ts:27](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/handlers/ner.ts#L24-L29)                                                                                                       | 返回数据进 LLM 前已脱敏               |
| scheduler 排除 quotes 源不进 6h 周期                                                                        | [scheduler.ts:13](file:///Volumes/SD/AI-Timeline-web/apps/worker/src/scheduler.ts#L13)                                                                                                        | 需同时排除 websearch                  |
| 当前 fetcher_type CHECK：`('rss','html','playwright','quotes','announcement','crawl')`                      | [schema.ts:41](file:///Volumes/SD/AI-Timeline-web/packages/db/src/schema.ts#L41)                                                                                                              | 需加 `'datapro'` 和 `'websearch'`     |
| 最新 migration 号：0027                                                                                     | [packages/db/migrations/](file:///Volumes/SD/AI-Timeline-web/packages/db/migrations/)                                                                                                         | 新 migration 从 0028 起               |

---

## 2. Sub-Agent 分工（沿用 v1.0 8 agent）

| Agent           | 本模块职责                                                          | 本模块 scope                                                                                                                                                                                                                                                    |
| --------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-infra`   | stack.yml 新增 secrets/env                                          | `deploy/stack.yml`                                                                                                                                                                                                                                              |
| `agent-db`      | entity_financials 表 / migration / seed / repos                     | `packages/db/src/schema.ts`（修改） · `packages/db/migrations/0028..0030` · `packages/db/src/repos/`                                                                                                                                                            |
| `agent-llm`     | 本模块不涉及（dataPro 数值禁止 LLM；websearch 不做 LLM 摘要）       | —                                                                                                                                                                                                                                                               |
| `agent-core`    | alert '企业风险' 分支 / computeD3Market / websearch quota 函数      | `packages/core/src/alert.ts` · `packages/core/src/scoring.ts`（追加） · `packages/core/src/quota.ts`（追加） · `packages/shared/src/types.ts`（AlertType 追加）                                                                                                 |
| `agent-worker`  | datapro + websearch fetcher / fetch dispatch / ner 触发 / scheduler | `apps/worker/src/fetchers/datapro/**` · `apps/worker/src/fetchers/websearch/**` · `apps/worker/src/handlers/{fetch,ner}.ts`（修改） · `apps/worker/src/scheduler.ts`（修改） · `apps/worker/src/queues.ts`（追加） · `apps/worker/src/runner.ts`（追加 worker） |
| `agent-web-api` | 本模块不涉及（后台 UI 属后续 milestone）                            | —                                                                                                                                                                                                                                                               |
| `agent-web-ui`  | 本模块不涉及                                                        | —                                                                                                                                                                                                                                                               |
| `agent-auth`    | 本模块不涉及                                                        | —                                                                                                                                                                                                                                                               |

**并行安全**：每个 task scope ≤ 1 agent；跨 agent 接口先由 `agent-core` / `packages/shared` 定义类型，再各自实现。

---

## 3. Phase 概览（两阶段，各自独立可合并）

| Phase    | 主题                                  | task 数 | 关键 sub-agent             |
| -------- | ------------------------------------- | ------- | -------------------------- |
| V12-P1   | dataPro 接入（企业风险 + 金融数据库） | 11      | db / core / worker / infra |
| V12-P2   | 豆包搜索接入（NER 事件驱动）          | 9       | db / core / worker / infra |
| **合计** |                                       | **20**  |                            |

**跨 phase 依赖**：V12-P2 依赖 P1 的基础 migration（T-ARK-12 depends_on T-ARK-01 fetcher_type CHECK）和 stack.yml secret 模式（T-ARK-19 depends_on T-ARK-10）。P2 核心功能（NER 触发 / websearch adapter / quota）不依赖 P1 业务代码，但基础设施层有顺序约束。P1 可独立上线；P2 上线前 P1 的 T-ARK-01 + T-ARK-10 必须先完成。

**数据流**：

```
                          ┌─────────────────────────────────────────┐
   每6h scheduler          │  sources(fetcher_type='datapro')        │
   (排除 quotes+websearch)─▶│  ┌─ risk source (T1, 企业风险)         │
                          │  │   dataPro HTTP POST → StandardItem[] │
                          │  │   url=datapro://risk/{code}/{hash}   │
                          │  │   → items 表 → 主管线                 │
                          │  │                                       │
                          │  └─ financial source (T1, 财务监测)     │
                          │      dataPro HTTP POST → 结构化数值     │
                          │      → entity_financials 表             │
                          │      → feeds d3Market (代码计算)         │
                          └─────────────────────────────────────────┘

  NER handler (ner.ts)     命中 C1/C2 实体
        │                   ├─ Redis 冷却检查 websearch:entity:{id}:24h
        │                   ├─ admitWebSearch(month) Lua 月度500限额
        │                   └─ enqueue fe-websearch {entityId,itemId}
        ▼
  websearch job            豆包搜索 web_search (直连 HTTP)
        │                   → StandardItem[] (tier=T3, category=突发新闻)
        │                   → items 表 → 主管线 (prefilter→...→curator)
        ▼
  computeAlert()           新增 '企业风险' 分支 (dataPro T1 风险 item)
```

---

## 4. V12-P1 · dataPro 接入（企业风险 + 金融数据库）

### T-ARK-01 entity_financials 表 + fetcher_type CHECK 扩展

```yaml
task: T-ARK-01
  goal: "新建 entity_financials 表 + 扩展 sources.fetcher_type CHECK 加 'datapro'，落地 migration 0028"
  constraints:
    - "禁止字符串拼 SQL；用 Drizzle schema 定义"
    - "entity_financials: id BIGSERIAL PK / entity_id BIGINT FK→entities(id) ON DELETE CASCADE / metric TEXT NOT NULL / value NUMERIC(20,4) / period TEXT NOT NULL (如 '2025Q4' / '2025年度') / observed_at TIMESTAMPTZ / fetched_at TIMESTAMPTZ DEFAULT now() / UNIQUE(entity_id, metric, period)"
    - "fetcher_type CHECK 扩展为 ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl', 'datapro') — DROP CONSTRAINT + ADD CONSTRAINT 原子化"
    - "entity_financials 不在 90 天保留清单内 → 永久保留（同 sources/entities），cleanup job 不删"
    - "不修改 v1.0/v1.1 已有 migration 文件"
    - "新增 schema 定义追加到 packages/db/src/schema.ts（同文件，不另开 schema-ark.ts），因 entity_financials 属于 v1.0 核心实体域"
  ask_agent_first:
    - "restate packages/db/src/schema.ts:41 当前 fetcher_type CHECK 与 entities 表结构"
    - "outline DROP CONSTRAINT + ADD CONSTRAINT 顺序与原子性（DO $$ BEGIN ... END $$）"
    - "list 测试（空库连续跑两次 idempotent + 有数据库 sources 行不丢）"
    - "list rollback SQL"
  owner: "agent-db"
  scope:
    - "packages/db/src/schema.ts (追加 entity_financials pgTable + 修改 fetcherTypeCheck)"
    - "packages/db/src/repos/sources.ts (FetcherType union 追加 'datapro')"
    - "packages/db/migrations/0028_entity_financials_and_datapro_type.sql"
  rollback: "DROP TABLE entity_financials; ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check; ALTER TABLE sources ADD CONSTRAINT sources_fetcher_type_check CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl'));"
  acceptance:
    - "drizzle-kit generate 产物与 schema 一致"
    - "pnpm -r typecheck 全绿"
    - "migration 在空库 + 有 v1.0/v1.1 数据库均成功，sources 行不丢"
    - "entity_financials UNIQUE(entity_id, metric, period) 约束存在"
    - "v1.0/v1.1 既有 migration 文件 git diff = 0"
```

### T-ARK-02 dataPro 信源 seed

```yaml
task: T-ARK-02
  goal: "落地 migration 0029 seed：两条 dataPro source（risk / financial），tier=T1，enabled=false，ON CONFLICT DO NOTHING"
  constraints:
    - "risk source: name='dataPro-C2企业风险', url='https://datapro.hqd.cn-beijing.volces.com/mcp/risk', fetcher_type='datapro', tier='T1', category='企业风险', enabled=false"
    - "financial source: name='dataPro-C2财务监测', url='https://datapro.hqd.cn-beijing.volces.com/mcp/financial', fetcher_type='datapro', tier='T1', category='财务监测', enabled=false"
    - "config 形状：{ type:'datapro', dataType:'risk'|'financial', entities:[{name:'宝胜股份',stockCode:'600973'},...], metrics:['roe','net_profit','revenue'] (仅 financial), maxStocksPerQuery:3 }"
    - "entities 列表从 entities 表 WHERE circle='C2' AND meta->>'stockCode' IS NOT NULL 对应的公司名 + stockCode（migration 0019 已 seed 14 家）"
    - "maxStocksPerQuery:3 对齐 dataPro 单次查询最多 3 只股票的硬限制（reviewer F7 修正：原 maxItemsPerQuery:5 与 adapter ≤3 冲突）"
    - "ON CONFLICT (url) DO NOTHING — 仅首次初始化，admin 后台修改不被 reseed 覆盖"
    - "seed 默认 enabled=false — 等 admin 验证 adapter 后手动启用"
    - "不碰其他 source 行"
  ask_agent_first:
    - "restate migration 0019 已 seed 的 C2 实体列表与 stockCode"
    - "outline config JSON 结构（risk vs financial 差异）"
    - "list 测试方法（SELECT count(*) 验证 + 重跑 idempotent）"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0029_datapro_sources_seed.sql"
  rollback: "DELETE FROM sources WHERE fetcher_type='datapro';"
  acceptance:
    - "migration 跑后 sources 表多 2 行（fetcher_type='datapro'）"
    - "两条 source 均 enabled=false"
    - "重跑 migration 不重复插入"
    - "config JSON 可被 JSON.parse 解析"
    - "v1.0/v1.1 既有 source 行不受影响"
```

### T-ARK-03 entity_financials repos

```yaml
task: T-ARK-03
  goal: "在 packages/db 实现 upsertEntityFinancials / listEntityFinancials repo 函数"
  constraints:
    - "upsertEntityFinancials(entityId, metrics: {metric, value, period, observedAt}[]) — ON CONFLICT (entity_id, metric, period) DO UPDATE SET value=EXCLUDED.value, observed_at=EXCLUDED.observed_at, fetched_at=now()"
    - "listEntityFinancials(entityId, opts?: {metric?: string, limit?: number}) — 返回按 observed_at DESC 排序"
    - "repo 函数放在 packages/db/src/repos/（如已存在则追加，否则新建 financials.ts）"
    - "从 packages/db/src/index.ts 导出"
    - "禁止在 repo 层调 LLM / 网络"
  ask_agent_first:
    - "restate packages/db/src/repos/ 现有结构与命名风格"
    - "outline upsert SQL（Drizzle 的 onConflictDoUpdate 用法）"
    - "list 测试（upsert 幂等 + list 排序）"
  owner: "agent-db"
  scope:
    - "packages/db/src/repos/financials.ts (新增)"
    - "packages/db/src/index.ts (追加 export * from './repos/financials')"
    - "packages/db/src/repos/__tests__/financials.test.ts (新增)"
  rollback: "revert PR；entity_financials 表保留（空表不影响）"
  acceptance:
    - "upsert 幂等：同 (entity_id, metric, period) 二次写入只更新 value/observed_at/fetched_at"
    - "list 按 observed_at DESC 返回"
    - "Vitest 全绿"
    - "pnpm -r typecheck 全绿"
    - "madge --circular packages/db 无循环"
```

### T-ARK-04 dataPro HTTP client

```yaml
task: T-ARK-04
  goal: "实现 fetchers/datapro/client.ts — 直连 HTTP POST 到 dataPro MCP 端点"
  constraints:
    - "URL 从 process.env.DATAPRO_BASE_URL 读（默认 'https://datapro.hqd.cn-beijing.volces.com/mcp'）"
    - "鉴权 header X-Agent-Plan-Key 从 resolveDataproApiKey() 读 — **必须照搬 firecrawl-client.ts:14 readEnvOrSecretFile 模式**：先读 process.env.DATAPRO_AGENT_PLAN_KEY，无则读 process.env.DATAPRO_AGENT_PLAN_KEY_FILE 指向的 secret 文件"
    - "无 API key 抛 SourceFetchError(FETCH_CONFIG)（照搬 firecrawl-client.ts:47 模式，不静默成功）"
    - "HTTP POST body: { jsonrpc: '2.0', method: 'tools/call', params: { name: 'dataPro_search', arguments: { query: '...' } }, id: 1 }"
    - "Content-Type: application/json"
    - "HTTP timeout 30s（dataPro 查询可能较慢）"
    - "返回值结构：response.result.content[0].text 是 JSON 字符串，parse 后含 items[].table 键值对"
    - "禁止在此层调 LLM"
    - "禁止存原始 HTML"
  ask_agent_first:
    - "restate firecrawl-client.ts:14-30 readEnvOrSecretFile 函数与 resolveFirecrawlApiKey 模式"
    - "outline MCP JSON-RPC over HTTP 的 request/response 结构"
    - "list 异常路径（401 / 超时 / 非 JSON / items 为空）"
    - "list 测试（mock fetch → 成功 / 401 / 超时）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/datapro/client.ts (新增)"
    - "apps/worker/src/fetchers/datapro/__tests__/client.test.ts (新增)"
  rollback: "revert PR；尚未被 adapter 引用"
  acceptance:
    - "mock fetch 返回合法 JSON-RPC → client 返回 parsed items[]"
    - "无 DATAPRO_AGENT_PLAN_KEY 且无 DATAPRO_AGENT_PLAN_KEY_FILE → throw SourceFetchError(FETCH_CONFIG)"
    - "HTTP 401 → throw SourceFetchError(FETCH_CONFIG, 'datapro auth failed')"
    - "HTTP 超时 → throw SourceFetchError（不 hang）"
    - "TypeScript strict 模式无 any"
    - "Vitest 全绿"
```

### T-ARK-05 dataPro types + adapter

```yaml
task: T-ARK-05
  goal: "实现 fetchers/datapro/types.ts + adapter.ts — risk→StandardItem[] / financial→entity_financials"
  constraints:
    - "DataproAdapter 接口: { name: string, fetch(config: DataproSourceConfig, ctx: FetchContext): Promise<StandardItem[]> }"
    - "DataproSourceConfig: { type:'datapro', dataType:'risk'|'financial', entities: {name, stockCode}[], metrics?: string[], maxStocksPerQuery?: number (默认 3，对齐 dataPro 限制) }"
    - "dataType='risk' 分支："
    - "  遍历 config.entities，每批 ≤3（dataPro 限制）调 dataPro_search(query=`{公司名} 司法诉讼 行政处罚 失信 经营异常`)"
    - "  将 items[].table 键值对映射为 StandardItem：url=`datapro://risk/{stockCode}/{hash8(案号或标题)}`（保证 UNIQUE），title=`{公司名} - {风险类型} - {案号}`, content=结构化键值对序列化（禁止 LLM），publishedAt=立案日期或 now()"
    - "  category='企业风险'（source.category 透传）"
    - "dataType='financial' 分支："
    - "  遍历 config.entities，每批 ≤3 调 dataPro_search(query=`{公司名} ROE 净利润 营收`)"
    - "  从 items[].table 取 ROE/净利润/营收等数值，调 upsertEntityFinancials 写入 entity_financials"
    - "  返回 []（financial 不产 item，数据落 entity_financials）"
    - "  **数值禁止 LLM 抽取**（NFR-102 同理，直接取 table 键值）"
    - "adapter 失败必须 throw SourceFetchError（照搬 crawl/firecrawl-adapter.ts:108-118 模式，**不照搬 quotes 的"失败返回[]"**）— 因 dataPro 走通用 fetch handler（fetch.ts:90-93），空结果会被 markSourceSuccess，故 adapter 必须用 throw 让 fetch handler 走 recordSourceFailure 路径"
    - "  例外：无 API key 抛 FETCH_CONFIG（T-ARK-04 已处理）"
    - "  例外：单个 entity batch 查询失败不阻断其他 batch（照搬 firecrawl-adapter.ts:99-106 单 query 失败不阻断模式）；全部 batch 失败才 throw"
    - "query 发送前必经 scrubText(query) 检查；若 level='block' 则跳过该 query（公司名通常 safe）"
  ask_agent_first:
    - "restate crawl/firecrawl-adapter.ts 的 adapter 接口与错误处理模式"
    - "restate quotes adapter 的 '失败返回 [] 不抛异常' 模式"
    - "outline risk→StandardItem 映射（url 确定性合成 / title / content 序列化格式）"
    - "outline financial→entity_financials upsert 调用链"
    - "outline scrubText 在 query 上的应用（公司名非 PII，预期 safe；但防御性检查）"
    - "list 测试（risk 映射 / financial upsert / 空 items / API key 缺失 / scrubber block 跳过）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/datapro/types.ts (新增)"
    - "apps/worker/src/fetchers/datapro/adapter.ts (新增)"
    - "apps/worker/src/fetchers/datapro/__tests__/adapter.test.ts (新增)"
  rollback: "revert PR；尚未被 dispatcher 引用"
  acceptance:
    - "risk 映射测试：mock client 返回含 table 键值 → adapter 输出 StandardItem[]，url 确定性唯一，content 含结构化数值"
    - "financial upsert 测试：mock client 返回 → adapter 调 upsertEntityFinancials → entity_financials 有行"
    - "financial 返回 []（不产 item）"
    - "空 items（全部 batch 查询返回空）→ throw SourceFetchError(FETCH_ALL_QUERIES_FAILED)（照搬 firecrawl-adapter.ts:113-118）"
    - "单 batch 失败不阻断其他 batch；全部 batch 失败 → throw SourceFetchError"
    - "无 API key → throw FETCH_CONFIG"
    - "scrubber block 测试：mock query 含手机号 → 该 query 被跳过，其他 query 正常执行"
    - "TypeScript strict 模式无 any"
    - "Vitest 全绿"
  depends_on: "T-ARK-04 (client), T-ARK-03 (repos)"
```

### T-ARK-06 dataPro dispatcher + fetch 路由

```yaml
task: T-ARK-06
  goal: "实现 fetchers/datapro/index.ts 注册 dispatcher + fetchers/index.ts 导出 + fetch.ts switch 加 case"
  constraints:
    - "fetchers/datapro/index.ts: registerDataproAdapter + fetchDatapro(config, ctx) 分发器（照搬 crawl/index.ts 模式）"
    - "fetchers/index.ts: 追加 export { fetchDatapro } from './datapro/index'"
    - "fetchers/types.ts: SourceConfig union 追加 DataproSourceConfig"
    - "fetch.ts:47 switch 追加 case 'datapro': rawItems = await fetchDatapro(config, context); break;"
    - "不破坏 v1.0/v1.1 既有 case"
  ask_agent_first:
    - "restate fetch.ts:47-68 switch 结构"
    - "restate fetchers/index.ts 当前 export 列表"
    - "list 测试（mock adapter → dispatcher 路由 → fetch 端到端）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/datapro/index.ts (新增)"
    - "apps/worker/src/fetchers/index.ts (追加 export)"
    - "apps/worker/src/fetchers/types.ts (追加 DataproSourceConfig)"
    - "apps/worker/src/handlers/fetch.ts (追加 case)"
    - "apps/worker/src/fetchers/__tests__/datapro-dispatch.test.ts (新增)"
  rollback: "revert PR；其他 fetcher 不受影响"
  acceptance:
    - "fetch.ts 对 config.type='datapro' 正确调 fetchDatapro"
    - "dispatcher 对未知 dataType throw FETCH_ADAPTER_UNKNOWN"
    - "v1.0/v1.1 fetcher 测试不挂"
    - "pnpm -r typecheck 全绿"
  depends_on: "T-ARK-05 (adapter)"
```

### T-ARK-07 alert.ts '企业风险' 分支 + AlertType 扩展

```yaml
task: T-ARK-07
  goal: "在 packages/shared AlertType 追加 'risk' + packages/core alert.ts computeAlert 新增 '企业风险' sourceCategory 分支（仅 C2）"
  constraints:
    - "shared/types.ts: AlertType 追加 'risk'（不删除现有值）"
    - "alert.ts computeAlert: **C1 已被首分支（line 11-13）捕获为 own**，企业风险分支不需要处理 C1 — 只在 litigation 分支之后、policy 分支之前插入 C2 分支："
    - "  if (sourceCategory === '企业风险' && entities 含 C2 && 不含 C1) → { alertType: 'risk', alertLevel: 'L2' }"
    - "  if (sourceCategory === '企业风险' && 无 C1/C2) → {} (无告警)"
    - "  C1 + 企业风险 → 走首分支 own/L2（现有逻辑，不需要新增）"
    - "**alert_type 触发统一在 computeAlert() 单一入口** — 硬约束守住"
    - "不修改现有分支逻辑（own / legal / policy / safety）"
  ask_agent_first:
    - "restate alert.ts:10-42 computeAlert 现有分支顺序与逻辑"
    - "restate shared/types.ts:6 AlertType 当前值"
    - "outline 新分支插入位置（litigation 之后，因为都是 sourceCategory 驱动）"
    - "list 测试（C1+企业风险 / C2+企业风险 / 无实体+企业风险 / C1+其他 sourceCategory 不受影响）"
  owner: "agent-core"
  scope:
    - "packages/shared/src/types.ts (AlertType 追加 'risk')"
    - "packages/core/src/alert.ts (追加企业风险分支)"
    - "packages/core/src/__tests__/alert.test.ts (追加用例)"
  rollback: "revert PR；AlertType 'risk' 是新增值，向后兼容"
  acceptance:
    - "C1 + sourceCategory='企业风险' → alertType='own', alertLevel='L2'（走首分支，非新分支）"
    - "C2 + sourceCategory='企业风险'（无 C1）→ alertType='risk', alertLevel='L2'"
    - "无 C1/C2 + sourceCategory='企业风险' → 无告警（空对象）"
    - "C2 + sourceCategory='上市公司涉诉' → 仍走 litigation 分支 alertType='legal'（新分支不干扰）"
    - "v1.0 既有分支测试全部仍通过（own / legal / policy / safety 不受影响）"
    - "pnpm -r typecheck 全绿"
```

### T-ARK-08 computeD3Market 纯函数

```yaml
task: T-ARK-08
  goal: "在 packages/core 实现 computeD3Market(entityFinancials) 纯函数，基于 entity_financials 最新一期指标代码计算 d3Market 分值"
  constraints:
    - "禁止依赖 packages/db（保持 core 纯函数原则，v1.0 硬约束）"
    - "禁止调 LLM"
    - "输入：EntityFinancialSnapshot[]（{ metric: string, value: number, period: string }[]，按 observed_at DESC 排序）"
    - "输出：number | null（0-100 clampScore，**null 表示无财务数据不覆盖 d3Market**，避免 0 拉低 qualityScore 加权和）"
    - "计算逻辑（代码计算，不调 LLM）："
    - "  基础分 50"
    - "  ROE > 15% → +20；ROE 10-15% → +10；ROE < 0 → -20"
    - "  营收增速 > 20% → +15；10-20% → +8；< 0 → -15"
    - "  净利润增速 > 20% → +15；10-20% → +8；< 0 → -15"
    - "  无数据（financials 为空或全无 ROE/营收/净利润指标）→ 返回 **null**（不是 0）"
    - "函数签名：computeD3Market(financials: EntityFinancialSnapshot[]): number | null"
    - "EntityFinancialSnapshot 类型定义在 packages/core/src/types.ts"
  ask_agent_first:
    - "restate packages/core/src/scoring.ts:5-14 computeD2Chain 的纯函数风格"
    - "restate scoring.ts:48 clampScore"
    - "outline computeD3Market 分档逻辑"
    - "list 测试（ROE 高/中/低/无 / 营收正负 / 净利润正负 / 全无数据 / 组合）"
  owner: "agent-core"
  scope:
    - "packages/core/src/scoring.ts (追加 computeD3Market)"
    - "packages/core/src/types.ts (追加 EntityFinancialSnapshot)"
    - "packages/core/src/index.ts (无需改，已 export * from scoring)"
    - "packages/core/src/__tests__/scoring.test.ts (追加用例)"
  rollback: "revert PR；尚未被 scorer handler 引用"
  acceptance:
    - "ROE=18% + 营收增速=25% + 净利润增速=22% → 50+20+15+15=100（clamp）"
    - "ROE=12% + 营收增速=15% + 净利润增速=12% → 50+10+8+8=76"
    - "ROE=-5% + 营收增速=-10% + 净利润增速=-8% → 50-20-15-15=0（clamp）"
    - "空 financials → 返回 null（不是 0）"
    - "有数据但 ROE/营收/净利润全缺 → 返回 null"
    - "madge --circular packages/core 无循环"
    - "Vitest 覆盖率 ≥ 90%"
```

### T-ARK-09 scorer handler 接入 computeD3Market

```yaml
task: T-ARK-09
  goal: "scorer handler 在计算 d3Market 时，查询 entity_financials 并调 computeD3Market 覆盖默认值"
  constraints:
    - "当前 scorer handler 从 prefilter / LLM 获取 d1Policy/d3Market/d4Tech/d5Business（d2Chain 代码计算）"
    - "改动：scorer 在拿到 item 命中的 entities 后，对每个 entity 查 entity_financials 最新一期，调 computeD3Market；**仅当返回非 null 时覆盖 LLM 的 d3Market**；返回 null 则保留 LLM 的 d3Market（向后兼容，不拉低 qualityScore）"
    - "若多个 entity 均有财务数据 → 取 topCircle（C1 > C2 > C3）对应 entity 的 d3Market"
    - "若无财务数据 → 保留 LLM 的 d3Market（向后兼容）"
    - "不改 v1.0 既有 d1Policy/d2Chain/d4Tech/d5Business 计算逻辑"
  ask_agent_first:
    - "restate apps/worker/src/handlers/scorer.ts 当前 d3Market 来源与计算流程"
    - "outline entity_financials 查询时机（scorer 阶段，item_entities 已写入）"
    - "list 测试（有财务数据覆盖 / 无财务数据保留 LLM / 多 entity 取 topCircle）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/handlers/scorer.ts (修改 d3Market 计算)"
    - "apps/worker/src/handlers/__tests__/scorer.test.ts (追加用例)"
  rollback: "revert PR；d3Market 回退为 LLM 输出"
  acceptance:
    - "有 entity_financials 数据 → d3Market = computeD3Market 结果"
    - "无 entity_financials 数据 → d3Market = LLM 输出（向后兼容）"
    - "v1.0 既有 scorer 测试不挂"
    - "pnpm -r typecheck 全绿"
  depends_on: "T-ARK-08 (computeD3Market), T-ARK-03 (repos)"
```

### T-ARK-10 stack.yml dataPro secrets

```yaml
task: T-ARK-10
  goal: "deploy/stack.yml 追加 dataPro 环境变量 + secret"
  constraints:
    - "worker service environment 追加: DATAPRO_BASE_URL=https://datapro.hqd.cn-beijing.volces.com/mcp"
    - "worker service secrets 追加: datapro_agent_plan_key（source: datapro_agent_plan_key）"
    - "worker service environment 追加: DATAPRO_AGENT_PLAN_KEY_FILE=/run/secrets/datapro_agent_plan_key"
    - "应用层从 *_FILE 读 secret 文件内容（沿用 v1.0 Firecrawl 模式）"
    - "不修改 v1.0/v1.1 已有 service 或 secret"
    - "TZ=Asia/Shanghai 注入"
  ask_agent_first:
    - "restate deploy/stack.yml worker service 现有 environment + secrets 结构"
    - "restate v1.0 Firecrawl API key 注入方式（_FILE suffix）"
    - "list 验证步骤（Portainer 部署后 worker env 有 DATAPRO_* 变量）"
  owner: "agent-infra"
  scope:
    - "deploy/stack.yml (worker service 追加)"
  rollback: "revert stack.yml；dataPro source 默认 enabled=false 不影响运行"
  acceptance:
    - "docker stack deploy 后 worker 容器 env 含 DATAPRO_BASE_URL + DATAPRO_AGENT_PLAN_KEY_FILE"
    - "v1.0/v1.1 已有 service 不受影响"
    - "worker 容器内 cat /run/secrets/datapro_agent_plan_key 有值（Portainer 配置后）"
```

### T-ARK-11 V12-P1 集成测试

```yaml
task: T-ARK-11
  goal: "V12-P1 端到端集成测试 — dataPro risk → items → pipeline → alert；dataPro financial → entity_financials → d3Market"
  constraints:
    - "mock dataPro client 返回 fixture 数据"
    - "测试 1：risk source fetch → items 插入 → NER 命中 C2 entity → curator computeAlert → alertType='risk'"
    - "测试 2：financial source fetch → entity_financials upsert → scorer 读 entity_financials → d3Market = computeD3Market"
    - "测试 3：无 API key → FETCH_CONFIG 错误 → source fail_count++"
    - "测试 4：scrubber 对含 PII 的 query 跳过"
    - "不修改既有测试"
  ask_agent_first:
    - "restate v1.0 fetch handler 端到端测试模式（apps/worker/src/__tests__/）"
    - "outline fixture 数据结构（dataPro risk 响应 / financial 响应）"
    - "list 测试文件组织"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/datapro/__tests__/integration.test.ts (新增)"
  rollback: "revert PR"
  acceptance:
    - "4 个集成测试全绿"
    - "v1.0/v1.1 既有测试不挂"
    - "pnpm -r typecheck 全绿"
  depends_on: "T-ARK-06 (dispatcher), T-ARK-07 (alert), T-ARK-09 (scorer)"
```

---

## 5. V12-P2 · 豆包搜索接入（NER 事件驱动）

### T-ARK-12 fetcher_type CHECK 扩展 + websearch seed

```yaml
task: T-ARK-12
  goal: "扩展 sources.fetcher_type CHECK 加 'websearch' + seed 一条 websearch source，落地 migration 0030"
  constraints:
    - "fetcher_type CHECK 扩展为 ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl', 'datapro', 'websearch')"
    - "seed: name='豆包搜索-突发新闻', url='https://open.feedcoopapi.com/search_api/web_search', fetcher_type='websearch', tier='T3', category='突发新闻', enabled=true"
    - "config: { type:'websearch', timeRange:'OneWeek', count:10, authInfoLevel:0 }"
    - "enabled=true 但 **不进定时周期**（scheduler 过滤）— 由 NER 事件驱动 enqueue"
    - "ON CONFLICT (url) DO NOTHING"
  ask_agent_first:
    - "restate 0028 migration 的 fetcher_type CHECK（T-ARK-01 已加 datapro）"
    - "outline DROP+ADD CONSTRAINT 顺序"
    - "list 测试（重跑 idempotent）"
  owner: "agent-db"
  scope:
    - "packages/db/src/schema.ts (修改 fetcherTypeCheck 追加 'websearch')"
    - "packages/db/src/repos/sources.ts (FetcherType union 追加 'websearch')"
    - "packages/db/migrations/0030_websearch_fetcher_type.sql"
  rollback: "ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check; ALTER TABLE sources ADD CONSTRAINT ... CHECK (fetcher_type IN (..., 'datapro')); DELETE FROM sources WHERE fetcher_type='websearch';"
  acceptance:
    - "migration 跑后 sources 表多 1 行（fetcher_type='websearch'）"
    - "重跑 migration 不重复插入"
    - "v1.0/v1.1 既有 source 行不受影响"
  depends_on: "T-ARK-01 (0028 migration 已加 datapro)"
```

### T-ARK-13 websearch queue + job type 定义

```yaml
task: T-ARK-13
  goal: "在 packages/shared QUEUES 追加 websearch + queues.ts 追加 WebsearchJob 类型与 createWebsearchQueue"
  constraints:
    - "shared/constants.ts: QUEUES 追加 websearch: 'fe-websearch'"
    - "queues.ts: 追加 interface WebsearchJob { entityId: number; entityName: string; itemId: number; correlationId?: string }"
    - "queues.ts: 追加 createWebsearchQueue(connection?)"
    - "queues.ts: 追加 QUEUE_WEBSEARCH = 'fe-websearch' 常量（如 QUEUES 已含则复用）"
    - "不修改 v1.0/v1.1 既有 queue 定义"
  ask_agent_first:
    - "restate queues.ts 现有 queue 定义模式（createQuotesFetchQueue / createBriefingGenQueue）"
    - "restate shared/constants.ts QUEUES 结构"
    - "list 测试（queue 创建 / job 类型）"
  owner: "agent-worker"
  scope:
    - "packages/shared/src/constants.ts (QUEUES 追加 websearch)"
    - "apps/worker/src/queues.ts (追加 WebsearchJob + createWebsearchQueue)"
    - "apps/worker/src/__tests__/queues.test.ts (追加用例)"
  rollback: "revert PR；queue 尚未注册 worker"
  acceptance:
    - "createWebsearchQueue() 返回 BullMQ Queue 实例"
    - "WebsearchJob 类型包含 entityId/entityName/itemId/correlationId"
    - "v1.0/v1.1 既有 queue 测试不挂"
```

### T-ARK-14 websearch quota 函数

```yaml
task: T-ARK-14
  goal: "在 packages/core/quota.ts 追加 WEBSEARCH_MONTHLY_BUDGET + websearchQuotaKey + admitWebSearch 函数"
  constraints:
    - "新增常量 WEBSEARCH_MONTHLY_BUDGET = 500"
    - "新增 WEBSEARCH_TTL_SECONDS = 32 * 24 * 3600 (32 天，覆盖最长月)"
    - "websearchQuotaKey(yearMonth: string): string → 'websearch:counter:{yearMonth}'"
    - "admitWebSearch(yearMonth: string, redis: RedisEvalLike): Promise<QuotaDecision> — 复用 ADMIT_LUA 脚本（限速器 Lua 硬约束守住）"
    - "QuotaDecision.state 复用 'admitted' | 'pending_over_quota'"
    - "禁止新增 Redis eval 脚本（复用 ADMIT_LUA）"
    - "纯函数 + Redis 注入，不依赖 packages/db"
  ask_agent_first:
    - "restate quota.ts:6-16 ADMIT_LUA 脚本与 admitToScoring 调用模式"
    - "restate quota.ts:22-24 quotaKey 命名规则"
    - "outline websearchQuotaKey 格式（yearMonth 如 '2026-06'）"
    - "list 测试（admitted / over_quota / 月度切换）"
  owner: "agent-core"
  scope:
    - "packages/core/src/quota.ts (追加 WEBSEARCH_MONTHLY_BUDGET / websearchQuotaKey / admitWebSearch)"
    - "packages/core/src/__tests__/quota.test.ts (追加用例)"
  rollback: "revert PR；函数尚未被引用"
  acceptance:
    - "admitWebSearch 第 1-500 次 → state='admitted'"
    - "admitWebSearch 第 501 次 → state='pending_over_quota'"
    - "月度切换后计数器重置（key 含 yearMonth）"
    - "复用 ADMIT_LUA（不新增 eval 脚本）"
    - "Vitest 全绿"
```

### T-ARK-15 websearch HTTP client + adapter

```yaml
task: T-ARK-15
  goal: "实现 fetchers/websearch/client.ts + adapter.ts — 直连豆包搜索 REST API"
  constraints:
    - "client.ts: HTTP POST 到 process.env.WEBSEARCH_API_URL（默认 'https://open.feedcoopapi.com/search_api/web_search'）"
    - "鉴权 header: Authorization: Bearer ${resolveWebsearchApiKey()} — **必须照搬 firecrawl-client.ts:14 readEnvOrSecretFile 模式**：先读 process.env.WEBSEARCH_API_KEY，无则读 process.env.WEBSEARCH_API_KEY_FILE 指向的 secret 文件"
    - "无 API key 抛 SourceFetchError(FETCH_CONFIG)（照搬 firecrawl-client.ts:47 模式）"
    - "request body: { Query, SearchType:'web', Count, TimeRange, Filter:{ AuthInfoLevel } }"
    - "HTTP timeout 15s"
    - "response: Result.WebResults[] → StandardItem[]（url=WebItem.Url, title=WebItem.Title, content=WebItem.Snippet, publishedAt=WebItem.PublishTime 或 now()）"
    - "adapter.ts: WebsearchAdapter { name:'doubao', fetch(ctx) } — 失败返回 [] 不抛异常（websearch 有独立 job handler T-ARK-18，不走通用 fetch handler，故空结果不会被误判为 markSourceSuccess；与 dataPro T-ARK-05 的 throw 模式不同）"
    - "query 发送前必经 scrubText(query) 检查；若 level='block' 则跳过"
    - "禁止在 fetcher 层调 LLM"
    - "禁止存原始 HTML（只存 Snippet 文本）"
  ask_agent_first:
    - "restate firecrawl-client.ts API key 解析 + 错误处理模式"
    - "restate quotes adapter '失败返回 [] 不抛异常' 模式"
    - "outline HTTP POST request/response 结构（参考豆包搜索 API 文档）"
    - "outline scrubText 在 query 上的应用（公司名非 PII，预期 safe）"
    - "list 测试（mock fetch → 成功 / 401 / 超时 / 空结果 / scrubber block）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/websearch/client.ts (新增)"
    - "apps/worker/src/fetchers/websearch/adapter.ts (新增)"
    - "apps/worker/src/fetchers/websearch/types.ts (新增)"
    - "apps/worker/src/fetchers/websearch/__tests__/client.test.ts (新增)"
    - "apps/worker/src/fetchers/websearch/__tests__/adapter.test.ts (新增)"
  rollback: "revert PR；尚未被 dispatcher 引用"
  acceptance:
    - "mock fetch 返回 WebResults[] → adapter 输出 StandardItem[]"
    - "无 WEBSEARCH_API_KEY 且无 WEBSEARCH_API_KEY_FILE → throw SourceFetchError(FETCH_CONFIG)"
    - "HTTP 401 → throw SourceFetchError"
    - "空 WebResults → 返回 []"
    - "scrubber block 测试：query 含手机号 → 跳过"
    - "TypeScript strict 模式无 any"
    - "Vitest 全绿"
```

### T-ARK-16 websearch dispatcher + fetch 路由 + scheduler 排除

```yaml
task: T-ARK-16
  goal: "fetchers/websearch/index.ts 注册 dispatcher + fetchers/index.ts 导出 + fetch.ts switch 加 case + scheduler 排除 websearch"
  constraints:
    - "fetchers/websearch/index.ts: registerWebsearchAdapter + fetchWebsearch(config, ctx) 分发器"
    - "fetchers/index.ts: 追加 export { fetchWebsearch }"
    - "fetchers/types.ts: SourceConfig union 追加 WebsearchSourceConfig"
    - "fetch.ts:47 switch 追加 case 'websearch': rawItems = await fetchWebsearch(config, context); break;"
    - "scheduler.ts:13 newsSources 过滤改为 `source.fetcherType !== 'quotes' && source.fetcherType !== 'websearch'`"
    - "websearch source 虽然 enabled=true 但不进 6h 定时周期（scheduler 过滤），仅由 NER 事件 enqueue"
    - "不破坏 v1.0/v1.1 既有 case 与 scheduler 逻辑"
  ask_agent_first:
    - "restate fetch.ts:47-68 switch 结构"
    - "restate scheduler.ts:13 newsSources 过滤逻辑"
    - "list 测试（dispatcher 路由 / scheduler 排除 websearch / v1.0 回归）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/websearch/index.ts (新增)"
    - "apps/worker/src/fetchers/index.ts (追加 export)"
    - "apps/worker/src/fetchers/types.ts (追加 WebsearchSourceConfig)"
    - "apps/worker/src/handlers/fetch.ts (追加 case)"
    - "apps/worker/src/scheduler.ts (修改 newsSources 过滤)"
    - "apps/worker/src/__tests__/scheduler.test.ts (追加用例)"
  rollback: "revert PR；其他 fetcher / scheduler 不受影响"
  acceptance:
    - "fetch.ts 对 config.type='websearch' 正确调 fetchWebsearch"
    - "scheduler 6h 周期不包含 fetcher_type='websearch' 的 source"
    - "scheduler 仍包含 fetcher_type='datapro' 的 source（dataPro 进定时周期）"
    - "v1.0/v1.1 fetcher + scheduler 测试不挂"
  depends_on: "T-ARK-15 (adapter), T-ARK-12 (migration)"
```

### T-ARK-17 NER 事件驱动 websearch 触发

```yaml
task: T-ARK-17
  goal: "在 ner.ts handler NER 完成后，对命中的 C1/C2 实体触发 websearch（Redis 冷却 + 月度限额）"
  constraints:
    - "NER 完成后（item_entities 已写入），对命中的 entity WHERE circle IN ('C1','C2')："
    - "  1. Redis 冷却检查：GET websearch:entity:{entityId}:24h — 存在则跳过该实体"
    - "  2. 月度限额：admitWebSearch(currentYearMonth, redis) — state='pending_over_quota' 则跳过 + 结构化日志 warn（不 enqueue，事件时效性，不补发）"
    - "  3. admitted → enqueue fe-websearch { entityId, entityName, itemId, correlationId } + SET websearch:entity:{entityId}:24h EX 86400"
    - "冷却键 TTL=86400s（24h）— 同实体 24h 内只搜一次（防同周期 100 item 命中同一 C2 实体耗尽月度额度）"
    - "月度耗尽 → 结构化日志 warn + 丢弃（区别于 scoring backlog，事件过时无补发价值）"
    - "不修改 NER 本身的实体识别逻辑"
    - "websearch enqueue 失败（Redis down）→ warn 日志，不阻断 NER 主流程"
    - "correlationId 从 NER job 透传，保持链路追踪"
  ask_agent_first:
    - "restate ner.ts:10-40 handleNerJob 流程"
    - "restate quota.ts admitWebSearch 接口（T-ARK-14）"
    - "outline Redis 冷却 + 限额检查顺序（先冷却去重，再限额，减少无效 incr）"
    - "outline fe-websearch job enqueue 方式（直接 Queue.add，不走 FlowProducer，因为 websearch 不在主管线 Flow 中）"
    - "list 测试（C1 触发 / C2 触发 / C3 不触发 / 冷却跳过 / 月度耗尽跳过 / Redis down 不阻断 NER）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/handlers/ner.ts (追加 websearch 触发逻辑)"
    - "apps/worker/src/handlers/__tests__/ner.test.ts (追加用例)"
  rollback: "revert PR；NER 回退为无 websearch 触发"
  acceptance:
    - "NER 命中 C1 entity → enqueue fe-websearch（1 个 job）"
    - "NER 命中 C2 entity → enqueue fe-websearch（1 个 job）"
    - "NER 命中 C3 entity → 不 enqueue"
    - "同实体 24h 内第二次 → 冷却跳过（不 enqueue）"
    - "月度 500 次耗尽 → 不 enqueue + warn 日志"
    - "Redis down → warn 日志 + NER 主流程不受影响"
    - "v1.0 NER 既有测试不挂"
  depends_on: "T-ARK-14 (quota), T-ARK-13 (queue)"
```

### T-ARK-18 websearch job handler + runner 注册

```yaml
task: T-ARK-18
  goal: "实现 jobs/websearch.ts handler + bootstrap.ts 注册 fe-websearch worker"
  constraints:
    - "handler 接收 WebsearchJob { entityId, entityName, itemId, correlationId }"
    - "handler 流程："
    - "  1. 从 entities 表拿 entity.aliases（如有）拼 query = entityName + ' ' + aliases.join(' ')"
    - "  2. scrubText(query) 检查；block 则跳过 + warn 日志"
    - "  3. 调 fetchWebsearch(sourceConfig, ctx) → StandardItem[]"
    - "  4. 对每个 StandardItem：查 items.url 去重（UNIQUE 约束），新 item 插入 items + item_analysis + enqueueItemPipeline"
    - "  5. 失败 attempts:3 后静默（非定时源，不 markSourceFailure — 区别于 v1.0 定时源）"
    - "sourceId 取 websearch source（fetcher_type='websearch'）的 id"
    - "bootstrap.ts startWorker() 追加 fe-websearch Worker 注册（concurrency=3）— 沿用 v1.0/v1.1 在 bootstrap.ts 注册 worker 的模式"
    - "不修改 v1.0/v1.1 既有 worker 注册"
  ask_agent_first:
    - "restate apps/worker/src/bootstrap.ts startWorker() 现有 worker 注册模式（fetchWorker / quotesFetchWorker 等）"
    - "restate fetch.ts:100-121 item 插入 + enqueueItemPipeline 模式"
    - "outline websearch handler 的 sourceId 获取（启动时查一次缓存 / 每次 query）"
    - "list 测试（成功 enqueue pipeline / url 去重 / 失败 attempts:3 / sourceId 解析）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/websearch.ts (新增)"
    - "apps/worker/src/bootstrap.ts (startWorker 追加 fe-websearch Worker + Queue)"
    - "apps/worker/src/jobs/__tests__/websearch.test.ts (新增)"
  rollback: "revert PR + 移除 worker 注册；fe-websearch queue 自动清空"
  acceptance:
    - "mock adapter 返回 3 条 → 3 个 item 插入 + 3 个 pipeline enqueued"
    - "url 已存在 → 去重跳过"
    - "adapter 返回 [] → 无 item 插入，不报错"
    - "adapter 失败 3 次 → job failed，不 markSourceFailure"
    - "v1.0/v1.1 既有 runner 测试不挂"
  depends_on: "T-ARK-16 (dispatcher), T-ARK-17 (NER 触发)"
```

### T-ARK-19 stack.yml websearch secrets

```yaml
task: T-ARK-19
  goal: "deploy/stack.yml 追加 websearch 环境变量 + secret"
  constraints:
    - "worker service environment 追加: WEBSEARCH_API_URL=https://open.feedcoopapi.com/search_api/web_search"
    - "worker service secrets 追加: websearch_api_key（source: websearch_api_key）"
    - "worker service environment 追加: WEBSEARCH_API_KEY_FILE=/run/secrets/websearch_api_key"
    - "不修改 v1.0/v1.1/v12-P1 已有 service 或 secret"
  ask_agent_first:
    - "restate T-ARK-10 stack.yml 已追加的 dataPro secret 模式"
    - "list 验证步骤"
  owner: "agent-infra"
  scope:
    - "deploy/stack.yml (worker service 追加 websearch)"
  rollback: "revert stack.yml；websearch source 不影响定时周期"
  acceptance:
    - "docker stack deploy 后 worker 容器 env 含 WEBSEARCH_API_URL + WEBSEARCH_API_KEY_FILE"
    - "v1.0/v1.1/v12-P1 已有 service 不受影响"
  depends_on: "T-ARK-10 (dataPro stack.yml 已改)"
```

### T-ARK-20 V12-P2 集成测试

```yaml
task: T-ARK-20
  goal: "V12-P2 端到端集成测试 — NER → websearch enqueue → job → items → pipeline"
  constraints:
    - "mock websearch client 返回 fixture 数据"
    - "测试 1：NER 命中 C2 entity → Redis 冷却不存在 + 月度限额 admitted → enqueue fe-websearch"
    - "测试 2：websearch job → 3 条 StandardItem → items 插入 + pipeline enqueued"
    - "测试 3：同实体 24h 内第二次 NER → 冷却跳过（不 enqueue）"
    - "测试 4：月度 500 次耗尽 → 不 enqueue + warn 日志"
    - "测试 5：websearch adapter 返回 [] → 无 item 插入，不报错"
    - "不修改既有测试"
  ask_agent_first:
    - "restate v1.0 NER handler 测试模式"
    - "outline fixture 数据结构（豆包搜索 WebResults 响应）"
    - "list mock Redis 行为（冷却 GET / 限额 eval）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/websearch/__tests__/integration.test.ts (新增)"
    - "apps/worker/src/handlers/__tests__/ner-websearch.test.ts (新增)"
  rollback: "revert PR"
  acceptance:
    - "5 个集成测试全绿"
    - "v1.0/v1.1/v12-P1 既有测试不挂"
    - "pnpm -r typecheck 全绿"
  depends_on: "T-ARK-18 (job handler), T-ARK-17 (NER 触发)"
```

---

## 6. 风险登记

| #   | 风险                                         | 严重度 | 缓解 task                                                                |
| --- | -------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| R1  | dataPro API 不可用 / 响应超时                | Medium | T-ARK-04 HTTP timeout 30s + adapter 失败返回 [] + source fail_count 机制 |
| R2  | dataPro 结构化数据格式变化                   | Medium | T-ARK-05 adapter 对 items[].table 做防御性解析 + fixture 测试            |
| R3  | 豆包搜索月度 500 次额度耗尽                  | Medium | T-ARK-14 月度 Lua 硬限额 + T-ARK-17 每实体 24h 冷却去重                  |
| R4  | websearch 结果信源不可控（T3）               | Low    | tier=T3 已在 scoring tCoef 降权；不作为主数据源，仅事件驱动补充          |
| R5  | NER 触发 websearch 引入 N+1 enqueue 风暴     | Medium | T-ARK-17 每实体 24h Redis 冷却（同周期 100 item 命中同一实体只搜 1 次）  |
| R6  | entity_financials 数值未经 LLM 但被 LLM 污染 | Low    | T-ARK-05 数值直接取 table 键值；T-ARK-08 computeD3Market 纯函数不调 LLM  |
| R7  | scrubber 误判公司名为 PII                    | Low    | T-ARK-05/15 scrubText 对公司名返回 safe；防御性检查不阻断正常 query      |
| R8  | dataPro/websearch API key 泄漏               | Medium | T-ARK-10/19 Portainer secret + \*\_FILE 注入（不硬编码）                 |
| R9  | 新 fetcher_type CHECK 扩展 rollback 风险     | Low    | T-ARK-01/12 双向 migration + rollback 路径已定义                         |
| R10 | 与 v1.0/v1.1 测试套件冲突                    | Low    | 全部 task acceptance 含"v1.0/v1.1 测试不挂"门槛                          |

---

## 7. 项目硬约束自检

| v1.0 硬约束                                | v1.2 是否触犯                                                                      | 落地位置                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------ |
| D2_chain 必须代码计算                      | ✅ 不涉及（d2Chain 不动，新增 d3Market 也是代码计算）                              | T-ARK-08                       |
| alert_type 统一在 computeAlert()           | ✅ 新增 '企业风险' 分支在 computeAlert 单一入口                                    | T-ARK-07                       |
| 配置必须存数据库                           | ✅ dataPro / websearch source 全入库                                               | T-ARK-02 / T-ARK-12            |
| 不存原始 HTML 快照                         | ✅ dataPro content 是结构化键值序列化；websearch content 是 Snippet 文本           | T-ARK-05 / T-ARK-15            |
| 不拉用户手机号                             | ✅ 不涉及                                                                          | —                              |
| 公网 LLM 调用前必经 scrubber               | ✅ dataPro/websearch query 经 scrubText 检查；返回数据进管线 LLM 已有 withScrubber | T-ARK-05 / T-ARK-15 / T-ARK-17 |
| 代理池不绕 robots.txt                      | ✅ dataPro/websearch 是 API 调用，不涉及 robots                                    | —                              |
| 数据保留 90 天（配置永久）                 | ✅ entity_financials 永久保留；items 90 天（v1.0 cleanup 覆盖）                    | T-ARK-01                       |
| bcrypt(12) + JWT httpOnly                  | ✅ 不涉及                                                                          | —                              |
| TZ=Asia/Shanghai + dayjs().tz()            | ✅ publishedAt 用 Date（API 返回 ISO）；不新增 toLocaleString                      | T-ARK-05 / T-ARK-15            |
| scoring_config seed ON CONFLICT DO NOTHING | ✅ v1.2 全部 seed 同等约束                                                         | T-ARK-02 / T-ARK-12            |
| 限速器 quota.ts Lua                        | ✅ websearch 月度限额复用 ADMIT_LUA                                                | T-ARK-14                       |
| cluster Redis 锁                           | ✅ 不涉及                                                                          | —                              |
| commit message [T-ARK-XX] 动词 + 范围      | ✅                                                                                 | 全部 task                      |
| /init 不重写 CLAUDE.md 而是 append         | ✅ v1.2 后续 append（不在本 spec 范围）                                            | —                              |

---

## 8. 后续动作

1. **用户评审本 spec**（v0.1）→ 修订 → v0.2
2. 建 Linear DMA issue（打 `codex` label）
3. 提交 Antigravity Plan Review（对齐 v1.0 DMA-24 / v1.1 DMA-153 节奏）
4. Fix Plan → v0.x（闭合 review findings）
5. **V12-P1 先行实施**（独立可上线）→ V12-P2 实施
6. P1 / P2 可并行实施（互不依赖），但建议 P1 先行验证 fetcher 基座模式
