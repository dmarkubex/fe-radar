# FE-Radar v1.2 — 火山方舟 Agent Plan Harness 接入 Requirements (v0.1)

> **模块代号**：`ark-harness`（专业数据集 + 豆包搜索）
> **状态**：DRAFT · v0.1 · 待评审
> **最后更新**：2026-06-24
> **作者**：Codex（Plan Stage 产出）
> **基础依赖**：v1.0 GA（M0–M5 Done）+ v1.1 commodity-briefing 已交付
> **与 base spec 的关系**：本文档**只描述增量**；未声明的 FR/NFR/约束沿用 base spec

---

## 0. 评审说明

按 AI Coding Kernel Full Mode 流程，本模块作为 v1.2 独立 feature 走完整 Plan Stage。

- 本文档约束 **WHAT**（要做什么），HOW 见 `design.md`，落地见 `tasks.md`
- 本模块**只增不改**，禁止修改 v1.0/v1.1 已交付字段与表
- 仅在以下处对 v1.0 做新增扩展：
  - `sources` 表 fetcher_type CHECK 追加 `'datapro'` / `'websearch'`（向后兼容）
  - `packages/shared` AlertType 追加 `'risk'`（向后兼容）
  - `packages/core` alert.ts computeAlert() 新增分支（单一入口硬约束守住）
  - 新增 `entity_financials` 表（永久保留，不进 90 天 cleanup）

---

## 1. 产品定位

**FE-Radar v1.2 · Ark Harness**：接入火山方舟 Agent Plan Harness 的两个 MCP 能力，填补 v1.0/v1.1 的四大数据盲区。

| 盲区                       | v1.2 方案                                                     | 信源分级                   |
| -------------------------- | ------------------------------------------------------------- | -------------------------- |
| C2 竞对财务监测空白        | dataPro 金融数据库 → entity_financials 表 → d3Market 代码计算 | T1（权威官方数据）         |
| 企业风险检索靠关键词       | dataPro 企业风险库 → items(category='企业风险') → 主管线      | T1                         |
| 上市公司涉诉仅靠公告       | dataPro 风险库补充（不替代公告抓取）                          | T1                         |
| Firecrawl 中文网页覆盖不足 | 豆包搜索 NER 事件驱动定向搜索（补充，非主源）                 | T3（全网搜索，信源不可控） |

**与 v1.0 两条产品哲学的承接**：

1. **信源比信息重要** → dataPro = T1 权威官方数据；豆包搜索 = T3 补充
2. **能用脚本就别用 Agent** → dataPro 数值直接取结构化 table 键值（禁止 LLM 抽取，NFR-102 同理）；d3Market 代码计算

---

## 2. 功能需求 (FR)

### FR-201 dataPro 企业风险库接入

对 C2 竞对实体定期（6h 周期）调用 dataPro_search，查询司法诉讼/行政处罚/失信/经营异常，结果写入 items 表（category='企业风险'），进入主管线。

### FR-202 dataPro 金融数据库接入

对 C2 上市公司实体定期查询 ROE/净利润/营收等核心指标，写入 entity_financials 表，作为 d3Market（市场）评分维度的代码计算输入。

### FR-203 豆包搜索事件驱动接入

不作为定时全量抓取。当 NER 命中 C1/C2 实体时，对该实体做一次定向 web_search，结果作为补充 item 进入主管线。每实体 24h 冷却 + 月度 500 次硬限额。

### FR-204 alert '企业风险' 分支

dataPro T1 风险 item 命中 C2 实体 → alertType='risk', alertLevel='L2'。C1 已被现有首分支捕获为 own/L2。

### FR-205 computeD3Market 代码计算

基于 entity_financials 最新一期 ROE/营收增速/净利润增速，代码计算 d3Market 分值（0-100 或 null）。null 表示无财务数据，不覆盖 LLM 的 d3Market，不拉低 qualityScore。

---

## 3. 非功能需求 (NFR)

| NFR     | 描述                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------- |
| NFR-201 | dataPro 数值禁止 LLM 抽取（NFR-102 同理），直接取 items[].table 键值                              |
| NFR-202 | MCP 调用前必经 packages/core/scrubber.ts（query 脱敏检查；返回数据进管线 LLM 已有 withScrubber）  |
| NFR-203 | 新 fetcher 遵循 StandardItem 接口（url / title / content / publishedAt）                          |
| NFR-204 | 配置存数据库（sources 表），不硬编码                                                              |
| NFR-205 | 限速器经 packages/core/quota.ts Lua 脚本（websearch 月度 500 次）                                 |
| NFR-206 | API key 注入照搬 Firecrawl readEnvOrSecretFile 模式（ENV + \*\_FILE 双通道）                      |
| NFR-207 | dataPro adapter 走通用 fetch handler → 失败必须 throw（不返回[]），否则空结果被 markSourceSuccess |
| NFR-208 | websearch 有独立 job handler → 失败可返回[]（不走通用 fetch handler）                             |

---

## 4. 信源分级

| 信源               | tier | category | 数据类型                             | 触发方式     |
| ------------------ | ---- | -------- | ------------------------------------ | ------------ |
| dataPro 企业风险库 | T1   | 企业风险 | 结构化（司法/行政/失信/经营异常）    | 6h 定时周期  |
| dataPro 金融数据库 | T1   | 财务监测 | 结构化（ROE/净利润/营收等 60+ 指标） | 6h 定时周期  |
| 豆包搜索           | T3   | 突发新闻 | 网页搜索结果（Title/Snippet/Url）    | NER 事件驱动 |

---

## 5. 数据保留

| 表                 | 保留期 | 说明                                                  |
| ------------------ | ------ | ----------------------------------------------------- |
| entity_financials  | 永久   | 配置类数据，不进 90 天 cleanup（同 sources/entities） |
| dataPro 风险 items | 90 天  | 走 v1.0 items 表 cleanup                              |
| websearch items    | 90 天  | 走 v1.0 items 表 cleanup                              |

---

## 6. 凭据

| 凭据                   | 用途                                 | 注入方式                               |
| ---------------------- | ------------------------------------ | -------------------------------------- |
| DATAPRO_AGENT_PLAN_KEY | dataPro HTTP header X-Agent-Plan-Key | Portainer secret + readEnvOrSecretFile |
| WEBSEARCH_API_KEY      | 豆包搜索 Authorization: Bearer       | Portainer secret + readEnvOrSecretFile |

---

## 7. 明确排除（v1.2 不做）

- 不删除 risk-search.ts / Firecrawl 风险检索路径（降级为 T2 补充）
- 不删除现有公告涉诉路径（dataPro 风险补充而非替代）
- 不做 entity_financials 后台 UI（数据落库即可，UI 属后续 milestone）
- 不做财务历史回填（go-live 后前向采集）
- 不在 websearch 结果上做 LLM 摘要（snippet 直接进 item.content）
