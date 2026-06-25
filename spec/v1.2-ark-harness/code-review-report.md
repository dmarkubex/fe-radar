# v1.2 火山方舟 Agent Plan Harness — 代码评审报告

- **评审范围**：工作区全部改动（22 改 + 19 新增文件），对应 dataPro 风险/财务接入、豆包 websearch 事件驱动、entity_financials + computeD3Market、`risk` 告警类型。
- **评审方式**：`/code-review high`（3 正确性 + 3 清理 + 1 altitude 多角度 finder → 单票复核，召回优先）。
- **结论**：核心机制（队列装配、迁移幂等、scrubText 前置、配额 Lua）实现规整；问题集中在**新链路两端的契约对齐**。其中 P0-1、P0-2 会让 T-ARK-09 与竞品风险告警两个核心卖点静默失效，**必须上线前修复**。
- **统计**：P0 阻断 3 项 / P1 重要 4 项 / P2 清理 3 项，共 10 项。

---

## P0 — 阻断（上线前必修）

### P0-1　财务指标键中英不一致 → T-ARK-09 代码计算 d3Market 永久失效 🔴

|        |                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 严重度 | Critical                                                                                                                                                                                                                |
| 位置   | `apps/worker/src/fetchers/datapro/adapter.ts:39`（写）<br>`apps/worker/src/handlers/scorer.ts:12`（D3_METRICS）<br>`packages/db/src/repos/financials.ts:98`（查）<br>`packages/core/src/scoring.ts`（findLatestMetric） |
| 复核   | CONFIRMED                                                                                                                                                                                                               |

**根因**：写入端 `FINANCIAL_METRIC_KEYS = ["ROE","净利润","营收","营收增速","净利润增速"]`（中文）落到 `entity_financials.metric`；读取端 `D3_METRICS = ["roe","revenue_growth","net_profit_growth"]`（英文小写）经 drizzle `inArray(metric, …)` 做 SQL 精确等值匹配。

**失败链路**：

1. `listLatestFinancialsByMetric` 生成 `metric IN ('roe','revenue_growth','net_profit_growth')` → 大小写敏感，`'ROE'`/`'营收增速'` 一行都匹配不到 → 返回 `[]`。
2. 退一步即使匹配到，`findLatestMetric` 用 `f.metric.toLowerCase() === 'revenue_growth'`，`'营收增速'` 永远不等。
3. `computeCodeD3Market` 恒返回 `null` → `d3Market = codeD3Market ?? result.d3Market` 始终回退 LLM。**整个 T-ARK-09「D3 代码计算」是死代码。**
4. seed `0029` 的 `config.metrics`（英文）也从未被 adapter 读取（见 P2-3）。

**影响**：违反「D3 必须代码计算」项目硬约束；scorer 单测把 `listLatestFinancialsByMetric` stub 成 `[]`，所以测试也发现不了。

**修复方向（推荐 altitude 级，不要再各写一份字符串列表）**：

- 在 `packages/core` 建一份**共享指标键常量 + 中→英归一化**（如 `净利润增速 → net_profit_growth`、`营收增速 → revenue_growth`、`ROE → roe`）。
- dataPro 写入端落库前归一化为统一英文 key；scorer/财务查询统一用该常量。
- 补一条端到端测试：中文键写入 → computeCodeD3Market 返回非 null。

---

### P0-2　新增 `risk` 告警类型未接入 API/UI 全链路 🔴

|        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 严重度 | High                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 位置   | `apps/web/lib/api/timeline-schema.ts:30`<br>`apps/web/lib/api/alerts-schema.ts:4`<br>`apps/web/lib/api/alerts-query.ts:171`（countAlertsByType）<br>`apps/web/lib/api/dashboard-query.ts:52`、`mock-data.ts:542`<br>`apps/web/components/shared/alert-strip.tsx:17`（alertTypeLabel / alertStripClass）<br>`apps/web/app/alerts/page.tsx:344`（alertLabel/channelText/alertReason）、filter Tab `46-58`<br>`apps/web/app/page.tsx:33`、`apps/web/app/search/page.tsx:21`（类型 cast） |
| 复核   | CONFIRMED                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**根因**：`computeAlert`（alert.ts:34）对 `sourceCategory==="企业风险"` + 竞品圈层产出 `{alertType:"risk"}` 并持久化（`alert_type` 是裸 `TEXT`，写入成功），但前端/API 全链路仍只认 `own/safety/policy/legal`。

**失败场景**：

- `GET /api/alerts?type=risk`、`/api/timeline?alert_type=risk`、`/api/search?alert_type=risk` → zod `z.enum([...])` 校验失败 → **400，risk 不可筛**。
- `countAlertsByType` 累加器硬编码 `{own,safety,policy,legal}`，成员判断只认这四个 → **risk 行被静默丢弃**，汇总徽标 / dashboard `alertsToday` 永远看不到 risk。
- `alertTypeLabel` / `alertLabel` fall through 渲染裸 token `"risk"`；`channelText` 落到「情报订阅群」误投；`alertStripClass` 走默认配色。
- `/alerts` 无 risk 筛选 Tab；`total` 计数不含 risk。

**影响**：dataPro 引入竞品风险信号的**核心目的（让风险可见可筛）被完全抵消**。

**修复清单**：

1. `timeline-schema.ts` + `alerts-schema.ts` 两处 enum 增加 `"risk"`。
2. `countAlertsByType` 累加器与成员判断、`dashboard-query.ts`、`mock-data.ts` 增加 `risk`。
3. `alert-strip.tsx` 的 `alertTypeLabel` / `alertStripClass` 增加 `risk` 分支（标签如「竞品风险」+ 配色）。
4. `alerts/page.tsx` 的 `alertLabel` / `channelText` / `alertReason` 增加 `risk` 分支 + 新增筛选 Tab + `total` 计入。
5. `page.tsx` / `search/page.tsx` 的 `alertType` 类型 cast 补 `"risk"`。

---

### P0-3　dataPro 风险记录无实体匹配时兜底挂到 batch[0] → 竞品风险误报 🔴

|        |                                                                                              |
| ------ | -------------------------------------------------------------------------------------------- |
| 严重度 | High                                                                                         |
| 位置   | `apps/worker/src/fetchers/datapro/adapter.ts:90`（findEntityByCompany）、`93`（mapRiskItem） |
| 复核   | CONFIRMED                                                                                    |

**根因**：`findEntityByCompany` 在公司字段 / 任意值都匹配不到批次任何实体时，最后 `return batch[0] ?? null`。risk 路径（`mapRiskItem`）拿到结果就生成条目，**没有 entityId 校验**；财务路径（`processFinancialResults`）有 `entityIdMap miss → continue` 保护。

**失败场景**：dataPro 风险查询返回一条不属于本批任何实体的记录 → 归属到 `batch[0]`（如宝胜股份）→ 生成 `datapro://risk/<batch[0].stockCode>/…` 条目 → 为一家**实际没有风险事件**的公司触发 `risk`/`legal` 竞品告警（误报）。

**修复方向**：risk 路径在无明确公司命中时 `return null`（对齐财务路径的 `continue`），不要兜底 batch[0]；或要求命中可信公司字段方可归属。

---

## P1 — 重要（建议本批修）

### P1-1　websearch 配额先扣后入队，失败被吞 → 配额泄漏 / 重复入队

|        |           |
| ------ | --------- | ---- | ------------------------------------------------------------------------------------------------ |
| 严重度 | Medium    | 位置 | `apps/worker/src/handlers/ner.ts:70`（admitWebSearch）、`84`（queue.add）、`85`（conn.set 冷却） |
| 复核   | CONFIRMED |

**根因**：`admitWebSearch` 先 `INCR` 月度计数，随后才 `queue.add` 与写 24h 冷却。任一步抛错被外层 `catch`（ner.ts:96「websearch trigger failed」）吞掉；`ADMIT_LUA` 只在超额时 `DECR`，不回滚下游失败。

**失败场景**：

- `queue.add` 抛错 → 计数已 +1 但无 job、无冷却，下次 NER 再 INCR → **烧掉 500/月预算**。
- `conn.set` 冷却在入队后抛错 → 冷却没写，同一 entity 下次 NER **重复入队 + 二次扣额**。

**修复方向**：把「入队 + 写冷却」放在配额消费成功后的同一保护段，失败时回滚计数（`DECR`）或先写冷却占位再入队；至少把该路径的异常单独记录而非与「Redis down」混为一谈。

---

### P1-2　parseNumber 剥除 亿/万/元 不做量级换算 → 绝对值财务数据量级损坏

|        |           |
| ------ | --------- | ---- | ---------------------------------------------------------------- |
| 严重度 | Medium    | 位置 | `apps/worker/src/fetchers/datapro/adapter.ts:112`（parseNumber） |
| 复核   | CONFIRMED |

**根因**：`value.replace(/[%亿万亿元,，]/g, "")` 直接删单位不乘倍率。`'12.5亿'` 与 `'12.5万'` 都变成 `12.5`。

**失败场景**：净利润 `'12.5亿'` 存为 `12.5`（应为 `1.25e9`），与 `'12.5万'` 无法区分，写入 `entity_financials` 的绝对值列（净利润/营收）损坏 4–8 个数量级。当前 D3 只用百分比指标（ROE/增速）暂不受影响，但这些列已落库，后续任何消费都会读到错值。

**修复方向**：识别 `亿`/`万` 后缀分别 ×1e8 / ×1e4；或在统一指标归一化（见 P0-1）时一并处理单位。

---

### P1-3　period 格式混用 → UNIQUE 去重失效 + 选「最新期」错误

|        |           |
| ------ | --------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 严重度 | Medium    | 位置 | `apps/worker/src/fetchers/datapro/adapter.ts:170`（period 取值）、`132`（currentPeriod）、`packages/core/src/scoring.ts`（findLatestMetric 字符串排序） |
| 复核   | CONFIRMED |

**根因**：`period = pickField(table, PERIOD_FIELDS) || currentPeriod()`，前者是 dataPro 原始字段（可能 `'2024年报'`/`'2024-Q4'`），后者是 `'2025Q2'`。两者格式不统一。

**失败场景**：同一季度一次存 `'2024年报'` 一次存 `'2025Q2'` → `UNIQUE(entity_id,metric,period)` 视为不同行 → 重复行；`findLatestMetric` 按字符串字典序排 period 选「最新」，跨格式时选错期次喂给 computeD3Market。

**修复方向**：统一 period 规范格式（建议 `YYYY-Q[1-4]` 或 `YYYYQn`），写入前归一化；findLatestMetric 改按结构化比较或用 `observed_at` 排序。

---

### P1-4　dataPro 空结果被当作硬失败 → 健康源被 markSourceFailure / 自动禁用

|        |                                            |
| ------ | ------------------------------------------ | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 严重度 | Medium                                     | 位置 | `apps/worker/src/fetchers/datapro/client.ts:134`（content[0].text 缺失即抛 FETCH_PARSE_ERROR）、`adapter.ts:217/229`（successCount=0 / totalRawItems=0 → throw） |
| 复核   | PLAUSIBLE（取决于 dataPro 空响应实际形态） |

**失败场景**：若 dataPro 对「本批无风险记录」返回 `content: []` 而非 `{items:[]}`，每批都抛 parse error → `successCount=0` → `FETCH_ALL_QUERIES_FAILED` → `recordSourceFailure`，正常空结果被误判为硬失败，累计 `DISABLE_AFTER_FAIL_DAYS=7` 天后自动禁用源。

**修复方向**：先确认 dataPro 空响应契约；把「合法空结果」与「解析失败」区分——空 content 视为 0 条而非抛错。

---

## P2 — 清理 / 可观测性（非阻断）

### P2-1　websearch adapter 吞掉所有异常且不打日志 → 配错 key 静默空跑

- 位置：`apps/worker/src/fetchers/websearch/adapter.ts:69`（`catch { return []; }`）
- `WEBSEARCH_API_KEY` 缺失/失效 → `websearchSearch` 抛 `FETCH_CONFIG`/`HTTP_ERROR` → 被空 catch 吞掉返回 `[]`，job 只打 info「no results」。运维无任何错误信号，豆包搜索全程不工作却看似正常。
- 修复：catch 内 `logger.warn({error}, …)` 后再返回 `[]`，保留可观测性。

### P2-2　upsertEntityFinancials 名为「批量」实为逐条 INSERT → N 次往返且非原子

- 位置：`packages/db/src/repos/financials.ts:34`（await 在 for 循环内）
- 每个财务批次（3 股 × 5 指标 = 15 条）发 15 次串行 DB 往返；中途失败部分写入。drizzle 支持单次 `.values([...])` + 一次 `onConflictDoUpdate` 合并为 1 次。

### P2-3　重复实现 / 死代码（reuse & simplification）

- `circleRank()`（`scorer.ts:74`）重复 core 的 `CIRCLE_RANK`（`scoring.ts:3`）——应 import 复用，否则圈层口径漂移会让 scorer 选错「最高圈」实体。
- `readEnvOrSecretFile` 在 `crawl/firecrawl-client.ts` / `datapro/client.ts:39` / `websearch/client.ts:24` **三处逐字复制**——抽成共享 helper。
- `fetchRisk`（adapter.ts:185）与 `fetchFinancial`（238）近乎复制：同样的 per-batch 循环、successCount/lastError/totalRawItems 记账、三分支 `SourceFetchError` 尾屑——应抽成 `{buildQuery, handleResults}` 参数化的单一流程。
- `DataproResultItem`（types.ts:21）重复 `DataproItem`（client.ts:14），造成 `.map(r => ({table: r.table}))` 无谓重包（207/259）。
- `config.metrics`（types.ts:12）从未被读取（死配置）。

---

## 修复对照清单（勾选用）

- [ ] **P0-1** 共享指标键常量 + 中→英归一化；dataPro 写入与 scorer 读取统一；补端到端测试
- [ ] **P0-2** 6 处补 `risk`：timeline/alerts schema enum、count、dashboard/mock、alert-strip、alerts page（label/channel/reason/Tab/total）、page/search 类型 cast
- [ ] **P0-3** risk 路径无明确公司命中时返回 null，去掉 batch[0] 兜底
- [ ] **P1-1** websearch 配额消费与入队/冷却的失败回滚 + 异常区分日志
- [ ] **P1-2** parseNumber 处理 亿/万 量级换算
- [ ] **P1-3** period 统一格式 + findLatestMetric/排序改 observed_at
- [ ] **P1-4** dataPro 空结果与解析失败区分，空结果不抛
- [ ] **P2-1** websearch adapter catch 补日志
- [ ] **P2-2** financials upsert 改单次多行
- [ ] **P2-3** 复用 circleRank/CIRCLE_RANK、抽 readEnvOrSecretFile、合并两 fetch 流程、删 DataproResultItem/config.metrics 死代码
