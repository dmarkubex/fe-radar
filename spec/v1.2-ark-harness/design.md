# FE-Radar v1.2 — 火山方舟 Agent Plan Harness 接入 Design (v0.1)

> **状态**：DRAFT · v0.1 · 待评审
> **最后更新**：2026-06-24
> **作者**：Codex（Plan Stage 产出）
> **依赖**：v1.0 `spec/design.md` v0.8 + v1.1 `design.md` v0.4 已读；本文档**只描述增量**
> **引用规范**：v1.0 章节引用为 `design §X`；本文档章节引用为 `§X`

---

## 0. 文档范围

约束 **HOW**（怎么做）。WHAT 见 `requirements.md`。落地见 `tasks.md`。

---

## 1. 架构差异图

v1.2 在 v1.0/v1.1 架构基础上**新增 2 个 fetcher 类型**，其他全部复用：

```
                ┌─────────────────────────────────────────┐
   每6h scheduler │  sources(fetcher_type='datapro')        │
   (排除 quotes   │  ┌─ risk source (T1, 企业风险)         │
    +websearch)  ─▶│  │   dataPro HTTP POST → StandardItem[] │
                │  │   url=datapro://risk/{code}/{hash}   │
                │  │   → items 表 → 主管线                 │
                │  │                                       │
                │  └─ financial source (T1, 财务监测)     │
                │      dataPro HTTP POST → 结构化数值     │
                │      → entity_financials 表             │
                │      → feeds d3Market (代码计算)         │
                └─────────────────────────────────────────┘

  NER handler     命中 C1/C2 实体
        │           ├─ Redis 冷却检查 websearch:entity:{id}:24h
        │           ├─ admitWebSearch(month) Lua 月度500限额
        │           └─ enqueue fe-websearch {entityId,itemId}
        ▼
  websearch job   豆包搜索 web_search (直连 HTTP REST)
        │           → StandardItem[] (tier=T3, category=突发新闻)
        │           → items 表 → 主管线
        ▼
  computeAlert()  新增 '企业风险' C2 分支 (dataPro T1 风险 item)
```

**变更原则**：

- 不新增进程，只新增 Worker 内的 BullMQ jobs（沿用 v1.0/v1.1 进程模型）
- 不新增 docker service（dataPro/豆包搜索都是 HTTP API 调用）
- 新增 1 张表（entity_financials）+ 2 个 fetcher_type（datapro/websearch）+ 1 个 queue（fe-websearch）

---

## 2. fetcher 架构

### 2.1 dataPro fetcher（照搬 crawl/ 模式）

```
fetchers/datapro/
  client.ts     — HTTP POST JSON-RPC, readEnvOrSecretFile 鉴权
  types.ts      — DataproSourceConfig, DataproAdapter 接口
  adapter.ts    — risk→StandardItem[] / financial→entity_financials
  index.ts      — registerDataproAdapter + fetchDatapro dispatcher
```

**错误语义**：照搬 crawl/firecrawl-adapter — 失败 throw SourceFetchError（不返回[]）。因 dataPro 走通用 fetch handler（fetch.ts:90-93），空结果会被 markSourceSuccess，故必须 throw 让 fetch handler 走 recordSourceFailure。

**单 batch 失败不阻断**：照搬 firecrawl-adapter.ts:99-106 — 单 entity batch 查询失败记录但不阻断其他 batch；全部 batch 失败才 throw FETCH_ALL_QUERIES_FAILED。

### 2.2 websearch fetcher（照搬 quotes/ 模式 + 独立 job）

```
fetchers/websearch/
  client.ts     — HTTP POST 直连, readEnvOrSecretFile 鉴权
  types.ts      — WebsearchSourceConfig, WebsearchAdapter 接口
  adapter.ts    — WebResults[] → StandardItem[]
  index.ts      — registerWebsearchAdapter + fetchWebsearch dispatcher
```

**错误语义**：失败返回 [] 不抛异常（websearch 有独立 job handler T-ARK-18，不走通用 fetch handler，空结果不会被误判为 markSourceSuccess）。

### 2.3 Secret 注入契约

两个 client 都**必须照搬** firecrawl-client.ts:14 `readEnvOrSecretFile(envName, fileEnvName)` 模式：

1. 先读 `process.env.DATAPRO_AGENT_PLAN_KEY`（或 `WEBSEARCH_API_KEY`）直连 env
2. 无则读 `process.env.DATAPRO_AGENT_PLAN_KEY_FILE`（或 `WEBSEARCH_API_KEY_FILE`）指向的 Docker secret 文件
3. 两者都无 → throw SourceFetchError(FETCH_CONFIG)

stack.yml 注入 `*_FILE` env + secret；应用层 readEnvOrSecretFile 解析。**不允许只注入 \*\_FILE 而 client 只读直连 env**（reviewer F1 finding）。

---

## 3. entity_financials 表设计

```sql
CREATE TABLE entity_financials (
  id          BIGSERIAL PRIMARY KEY,
  entity_id   BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,          -- 'roe' / 'net_profit' / 'revenue' / ...
  value       NUMERIC(20,4),          -- 精确数值（禁止 LLM 抽取）
  period      TEXT NOT NULL,          -- '2025Q4' / '2025年度'
  observed_at TIMESTAMPTZ,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_id, metric, period)
);
```

**保留策略**：永久保留（配置类数据，不进 90 天 cleanup）。

**upsert 语义**：ON CONFLICT (entity_id, metric, period) DO UPDATE SET value=EXCLUDED.value, observed_at=EXCLUDED.observed_at, fetched_at=now()。

---

## 4. d3Market 代码计算

### 4.1 computeD3Market 纯函数

```typescript
function computeD3Market(financials: EntityFinancialSnapshot[]): number | null;
```

- 输入：entity_financials 最新一期指标（按 observed_at DESC）
- 输出：0-100（clampScore）或 **null**（无数据时不覆盖 LLM d3Market，不拉低 qualityScore）
- 计算逻辑：基础分 50 + ROE 分档 + 营收增速分档 + 净利润增速分档
- **禁止调 LLM**（core 纯函数硬约束）

### 4.2 scorer handler 接入

scorer 在拿到 item 命中 entities 后，查 entity_financials → 调 computeD3Market：

- 返回非 null → 覆盖 LLM 的 d3Market
- 返回 null → 保留 LLM 的 d3Market（向后兼容）
- 多 entity 有财务数据 → 取 topCircle（C1 > C2 > C3）对应 entity

---

## 5. alert '企业风险' 分支

### 5.1 computeAlert 新增分支

**C1 已被首分支（alert.ts:11-13）捕获为 own/L2**，企业风险分支只处理 C2：

```typescript
// 插入位置：litigation 分支之后，policy 分支之前
if (
  sourceCategory === "企业风险" &&
  hasCompetitorCircle(entities) &&
  !entities.some((e) => e.circle === "C1")
) {
  return { alertType: "risk", alertLevel: "L2" };
}
```

### 5.2 AlertType 扩展

`packages/shared/src/types.ts`：`AlertType` 追加 `'risk'`（不删除现有值）。

---

## 6. websearch NER 事件驱动

### 6.1 触发链路

```
NER handler (ner.ts)
  → NER 完成，item_entities 已写入
  → 对命中 entity WHERE circle IN ('C1','C2')
    → 1. Redis GET websearch:entity:{entityId}:24h（存在→跳过）
    → 2. admitWebSearch(currentYearMonth, redis) Lua 月度500限额
    → 3. admitted → enqueue fe-websearch + SET 冷却键 EX 86400
    → 4. over_quota → warn 日志 + 丢弃（事件时效性，不补发）
```

### 6.2 双重去重

1. **每实体 24h Redis 冷却**：同实体 24h 内只搜一次（防同周期 100 item 命中同一 C2 实体耗尽月度额度）
2. **月度 500 次 Lua 硬限额**：复用 quota.ts ADMIT_LUA 脚本（限速器 Lua 硬约束守住）

### 6.3 websearch job handler

- 独立 job（不走通用 fetch handler）
- 失败 attempts:3 后静默（非定时源，不 markSourceFailure）
- sourceId 取 websearch source（fetcher_type='websearch'）的 id
- 结果 StandardItem[] → 插 items → enqueueItemPipeline

### 6.4 scheduler 排除

`scheduler.ts:13` newsSources 过滤改为 `!== 'quotes' && !== 'websearch'`：

- websearch source enabled=true 但不进 6h 定时周期（仅 NER 事件 enqueue）
- dataPro source 进 6h 定时周期

---

## 7. dataPro MCP 调用协议

### 7.1 HTTP 请求

```
POST {DATAPRO_BASE_URL}  (默认 https://datapro.hqd.cn-beijing.volces.com/mcp)
Header: X-Agent-Plan-Key: {resolvedKey}
Header: Content-Type: application/json
Body: {
  jsonrpc: '2.0',
  method: 'tools/call',
  params: { name: 'dataPro_search', arguments: { query: '...' } },
  id: 1
}
```

### 7.2 响应解析

`response.result.content[0].text` 是 JSON 字符串，parse 后含 `items[].table` 键值对（精确数值）。

### 7.3 批量查询

- 单次查询最多 3 只股票（dataPro 限制）
- config.maxStocksPerQuery 默认 3
- adapter 遍历 config.entities，每批 ≤3 调用

---

## 8. 豆包搜索 REST API

### 8.1 HTTP 请求

```
POST {WEBSEARCH_API_URL}  (默认 https://open.feedcoopapi.com/search_api/web_search)
Header: Authorization: Bearer {resolvedKey}
Header: Content-Type: application/json
Body: {
  Query: '搜索词',
  SearchType: 'web',
  Count: 10,
  TimeRange: 'OneWeek',
  Filter: { AuthInfoLevel: 0 }
}
```

### 8.2 响应解析

`Result.WebResults[]`，每项含 `Title` / `SiteName` / `Url` / `Snippet` / `Summary` / `Content` / `PublishTime` / `AuthInfoLevel`。

映射为 StandardItem：url=Url, title=Title, content=Snippet, publishedAt=PublishTime 或 now()。

### 8.3 限流

- 账号维度默认 5 QPS
- 每月 500 次免费额度（与 Global 版共用）
