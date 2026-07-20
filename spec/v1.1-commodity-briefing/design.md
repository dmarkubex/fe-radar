# FE-Radar v1.1 — Commodity Briefing Design (v0.4)

> **状态**：APPROVED-with-conditions（Antigravity Plan Review [DMA-153](https://linear.app/dmarkubex/issue/DMA-153) 2026-05-19 · 3 Minor + 4 Edge 已闭合）· 与 `requirements.md` v0.3 配对
> **最后更新**：2026-05-19
> **作者**：Claude Code（Plan Stage 产出 · Plan-Fix 闭合 v0.4）
> **依赖**：v1.0 `spec/design.md` v0.8 已读；本文档**只描述增量**
> **引用规范**：v1.0 章节引用为 `design §X`；本文档章节引用为 `§X`
> **v0.3 → v0.4 修复点**（DMA-153 review report `.ai/linear/v11-plan-review-report.md`）：
>
> - **M1**：`commodity_briefings` 新增 `template_version INT NOT NULL` + 索引（§7.1）
> - **M2**：`briefing_targets` 新增 `disabled_at TIMESTAMPTZ` + 软删 partial index（§7.1）
> - **E1**：§5.2 step 1 precheck 增加 `quotes-fetch` 队列陈旧度检查（队列非空 → 延长等待 ×2）
> - **E2**：`raw_text` 单位口径统一为 **2000 字符**（Unicode code points），与 requirements §9.2 / tasks T-CB-01 一致（§7.1）
> - **E3**：§6.5 增 UI 降级提示约定（样本 < 10 时 `/briefing/[id]` 必须显示「近期数据样本不足，支撑/压力位计算已降级」）
> - M3 / E4 修复点详见 `tasks.md` v0.4（T-CB-09 / T-CB-03）
>   **v0.2 → v0.3 变更**：内化 Q-11G/H/I/J/L 5 项 Human-decision（详见 requirements §11.1）· 风险 R5（16:00 夜盘）措辞对齐 · 后续动作清单更新
>   **v0.1 → v0.2 修复点**：6 张新表口径统一 / raw_text 边界（不存全 HTML）/ BRIEFING_SCHEMA 去除 LLM support/resistance / download API 端点 / actionCard 默认 + file 推送移至 v1.2

---

## 0. 文档范围

约束 **HOW**（怎么做）。WHAT 见 `requirements.md`。落地见 `tasks.md`。

读者：Antigravity Plan Review、Codex Execute、未来运维。

---

## 1. 架构差异图

v1.1 在 v1.0 架构（`design §1`）基础上**新增 5 个组件**（图中加粗），其他**全部复用**：

```
                ┌─────────────────────────┐
                │   钉钉开放平台 OAuth     │  ←  v1.0 已有，复用
                └────────────┬────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│            Web (Next.js 15 一体化)                       │
│  v1.0 Pages: 时间线 / 精选 / 日报 / 告警 / 搜索 / 后台   │
│  v1.1 新增  : /briefing /briefing/[id]                  │← 新增
│  v1.1 admin : /admin/briefing/targets                   │← 新增
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             ▼                            ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   Postgres 16        │      │   Redis 7                │
│   + pgvector + v1.1  │◀────▶│   BullMQ + v1.1 queues   │← 新增 quotes / briefing-gen / briefing-push
│   新表：6 张         │      │                          │
└──────────▲───────────┘      └──────────┬───────────────┘
           │                             │
           │                             ▼
           │            ┌────────────────────────────────┐
           │            │  Worker（已有进程，新增 jobs） │
           │            │  v1.0 已有：fetcher/.../daily   │
           │            │  v1.1 新增：                    │
           │            │  ⑨ quotes-fetcher 工作日 15:30  │← 新增
           │            │  ⑩ briefing-gen   工作日 16:00  │← 新增
           │            │  ⑪ briefing-push  工作日 16:05  │← 新增
           │            └──────┬─────────────┬───────────┘
           │                   │             │
           ▼                   ▼             ▼
   ┌──────────────┐    ┌──────────────┐ ┌──────────────┐
   │ Kimi K2.6    │    │  MinIO       │ │  钉钉群机器人 │
   │ (LLM 段落)   │    │  (docx 存档) │ │  webhook     │← 新增
   │ via scrubber │    │  v1.0 已有   │ │              │
   └──────────────┘    └──────────────┘ └──────────────┘

           ▲
           │
   ┌───────────────────────────────────────┐
   │ RSSHub (内网自部署)                    │← 新增 docker service
   │ 包装 SMM / 生意社 / 长江有色 / 中汽协   │
   └───────────────────────────────────────┘
```

**变更原则**：

- 不新增进程，只新增 Worker 内的 BullMQ jobs（沿用 v1.0 进程模型）
- 新增 1 个 docker service（RSSHub），不动 v1.0 stack 其他服务
- 复用 v1.0 LLM / scrubber / Pino / Grafana / MinIO / cron 基础设施

---

## 2. 复用 v1.0 的模块清单

| v1.0 模块                                      | 复用方式                                        | v1.1 是否动它                                              |
| ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `packages/db` schema（sources / entities）     | 追加行 / 追加 entity 类型                       | 不修改 v1.0 列；仅 `sources.fetcher_type` CHECK 扩展（§7） |
| `packages/db` schema（其他表）                 | 不读不写                                        | 不修改                                                     |
| `apps/worker/fetchers/{rss,html,playwright}`   | RSSHub 走 rss fetcher / 央行走 html fetcher     | 不修改                                                     |
| `apps/worker/lib/{proxy-pool,ua-pool,robots}`  | quotes fetcher 复用                             | 不修改                                                     |
| `apps/worker/scheduler`                        | 新增 cron 项                                    | 仅追加新 cron entry，不改现有                              |
| `apps/worker/jobs/daily-gen`                   | 不读不写                                        | 不修改                                                     |
| `packages/llm/{client,scrubber}`               | Kimi client + scrubber middleware 复用          | 不修改；新增 `briefing-schema.ts`                          |
| `packages/core/scrubber.ts`                    | 简报 LLM 调用前必经                             | 不修改                                                     |
| `packages/shared/{dayjs,errors,constants}`     | dayjs Asia/Shanghai / AppError 子类 / cron 常量 | 仅追加常量，不修改已有                                     |
| `apps/web/middleware.ts`                       | RBAC editor+/admin 守卫                         | 不修改                                                     |
| `apps/web/lib/auth`                            | 钉钉 OAuth provider                             | 不修改                                                     |
| Pino logger / Grafana dashboard / MinIO backup | 沿用                                            | 仅追加面板行                                               |

---

## 3. 新增模块拆分

```
apps/
  worker/src/
    fetchers/
      quotes.ts                   ← 新增（数值型 fetcher，与 rss/html/playwright 并列）
      quotes/
        shfe.ts                   ← 上期所适配器
        gfex.ts                   ← 广期所适配器
        lme.ts                    ← LME 延迟数据适配器
        pboc.ts                   ← 央行 USD/CNY 中间价适配器
        chinabond.ts              ← 中国货币网 10Y 国债适配器
        rsshub-extract.ts         ← RSSHub item 数值正则抽取
        __tests__/*
    jobs/
      quotes-fetch.ts             ← 新增 job：拉数值入库
      briefing-gen.ts             ← 新增 job：LLM 生成 + docx 渲染
      briefing-push.ts            ← 新增 job：钉钉机器人推送
      __tests__/*
    lib/
      briefing-render.ts          ← docxtemplater 封装
      dingtalk-bot.ts             ← 钉钉群机器人 webhook 客户端 + 加签
      __tests__/*
  web/app/
    briefing/
      page.tsx                    ← /briefing 列表
      [id]/page.tsx               ← /briefing/[id] 详情
    (admin)/admin/
      briefing/
        targets/page.tsx          ← /admin/briefing/targets
    api/
      briefing/
        route.ts                  ← GET 列表
        [id]/route.ts             ← GET 详情
        [id]/regenerate/route.ts  ← POST 重新生成
        [id]/repush/route.ts      ← POST 重新推送
        targets/route.ts          ← GET / POST / PUT
        targets/[id]/route.ts     ← DELETE
        targets/[id]/test/route.ts← POST 测试推送
packages/
  db/src/
    schema-commodity.ts           ← 新增 schema：6 张新表（commodity_quotes / commodity_briefings / briefing_targets / briefing_pushes / briefing_holidays / briefing_template_fields；与 v1.0 schema.ts 平级，单独文件）
    migrations/
      0008_commodity_briefing.sql ← 新增表 + sources.fetcher_type CHECK 扩展（v1.0 已用到 0007_users_merge）
      0009_commodity_seed.sql     ← 信源 seed + 模板字段 seed + 节假日 seed
  core/src/
    briefing.ts                   ← 纯函数：数值清洗 / 涨跌计算 / 模板字段映射
    __tests__/briefing.test.ts
  llm/src/
    briefing-schema.ts            ← Kimi structured output JSON schema
deploy/
  stack.yml                       ← 新增 rsshub service（追加）
  rsshub/
    Dockerfile                    ← 可选：自定义 RSSHub 镜像（如需补 route）
design/templates/
  briefing.docx                   ← docx 模板（用户提供的占位符版本）
```

**模块边界**（与 base `design §3` 一致）：

- `apps/web` 与 `apps/worker` 仍**不互相 import**
- 跨 package 经 `index.ts` 公共出口
- `packages/core/briefing.ts` 仍**不依赖** `packages/db`
- `packages/llm/briefing-schema.ts` 不引入业务逻辑，仅 schema + system prompt

---

## 4. 抓取层设计

### 4.1 quotes fetcher 总览

数值型 fetcher 与 rss/html/playwright 并列，作为第 4 类 `fetcher_type`。`sources.config` JSONB 存适配器路由与字段：

```json
{
  "type": "quotes",
  "adapter": "shfe",
  "metric_keys": ["cu_main_close", "cu_main_change_pct"],
  "endpoint": "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat",
  "retry": { "max": 3, "backoffMs": 1500 },
  "raw_text_keep": true
}
```

### 4.2 适配器接口

```ts
// apps/worker/src/fetchers/quotes/types.ts
export interface QuoteSample {
  metricKey: string; // 例如 "cu_main_close"
  value: number | null; // 失败时 null
  changePct: number | null;
  observedAt: Date; // 数据指向的时间点（交易日收盘）
  rawText: string; // 原始文本快照（NFR-102 审计用）
  sourceId: number; // sources.id
}

export interface QuotesAdapter {
  name: string;
  fetch(source: SourceRecord, now: Date): Promise<QuoteSample[]>;
}
```

适配器列表：`shfe` / `gfex` / `lme` / `pboc` / `chinabond` / `rsshub-extract`。

### 4.3 RSSHub 数值抽取

RSSHub 返回的 RSS item 通常是"标题 + HTML 摘要"。`rsshub-extract.ts` 走三步：

1. **strip HTML**：先用 `sanitize-html` 剥离全部标签 → 纯文本（保留行内空白）
2. **regex match**：用预编译正则提取首个浮点数（如 "电池级碳酸锂今日均价 6.82 万元/吨" → 提取 `6.82` × 单位换算）
3. **失败兜底**：命中失败 → 标 `value=null` + `rawText=<纯文本，maxLength=2000 字符（Unicode code points · v0.4 fix E2）>` + 入 admin Dashboard 黄色告警 backlog；**绝不调 LLM 抽取**（NFR-102）

**raw_text 边界硬约束**（沿用 v1.0 FR-12 / requirements.md §9.2）：

- 必须先 strip HTML（不存原始 HTML 快照）
- 长度截断 ≤ 2000 字符（Unicode code points · v0.4 fix E2；仅保留与数值相关的最小上下文）
- 该约束对所有 quotes adapter（shfe / gfex / lme / pboc / chinabond / rsshub-extract）一致

正则规则放在 `sources.config.regex_rules` 数组里，统一使用 snake_case：`{ pattern, metric_key, unit_multiplier?, group? }`；admin 可后台维护；初始 seed 见 T-CB-09。

### 4.4 cron 调度

新增在 `apps/worker/src/scheduler.ts`（追加，不动现有）：

| Job             | Cron            | TZ            | 备注                             |
| --------------- | --------------- | ------------- | -------------------------------- |
| `quotes-fetch`  | `30 15 * * 1-5` | Asia/Shanghai | 工作日 15:30，紧跟上期所收盘     |
| `briefing-gen`  | `0 16 * * 1-5`  | Asia/Shanghai | 工作日 16:00，依赖 quotes 已入库 |
| `briefing-push` | `5 16 * * 1-5`  | Asia/Shanghai | 工作日 16:05                     |

**Job 间依赖**：`briefing-gen` 启动时检查当日 `commodity_quotes` 第一层字段（§6.1）入库行数 ≥ 5 才执行，否则延迟 5 分钟重试，最多 2 次，全失败则降级（缺失字段标 "—"，简报照常生成 + 黄色告警）。

### 4.5 节假日跳过

`briefing_holidays` 表（admin 维护）记录跳过日期。三个 job 入口统一检查 `isBusinessDay(now)`，命中节假日直接 return（结构化日志记录）。

---

## 5. 处理 Pipeline

### 5.1 quotes-fetch job

```
[scheduler] → enqueue quotes-fetch (no payload)
              ↓
[worker] → 加载 sources WHERE fetcher_type='quotes' AND enabled=true
         → 对每个 source 并发拉（concurrency=5，沿用 v1.0 FETCH_CONCURRENCY）
         → 每个 source 返回 QuoteSample[]
         → upsert into commodity_quotes (metric_key, observed_at) UNIQUE
         → 失败：source.fail_count++，连续 7 失败禁用（沿用 v1.0 DISABLE_AFTER_FAIL_DAYS）
```

### 5.2 briefing-gen job

```
[scheduler] → enqueue briefing-gen (briefing_date)
              ↓
[worker] step 1 (precheck)：
         → 检查 quotes-fetch BullMQ 队列陈旧度（v0.4 fix E1：waiting + active > 0 视为 quotes 未落齐
           → 延迟 5min 重试 ×2，避免 16:00 启动时 15:30 队列因代理池故障积压导致 degraded 误判）
         → 检查 commodity_quotes 当日字段覆盖率
         → < 5 字段 → 延迟重试 ×2 → 仍不足则降级
         ↓
[worker] step 2 (build context)：
         → 读 commodity_quotes 当日 + 近 5 交易日 CU/LC 主力序列
         → 读 v1.0 items WHERE published_at >= now-24h AND NER 命中铜锂相关 product / company
           （SELECT * FROM item_analysis JOIN items ON ... WHERE category IN ('市场与价格','项目与招投标') ORDER BY quality_score DESC LIMIT 30）
         ↓
[worker] step 3 (LLM 生成)：
         → 调 DeepSeek with BRIEFING_SCHEMA（structured JSON · 7 段；原设计 Kimi K2.6，因网关无公网出口改用 DeepSeek）
         → withScrubber 中间件强制脱敏（v1.0 强约束）
         → 输出 7 段：cu.logic_summary / cu.outlook.trend / lc.logic_summary / lc.outlook.trend
                      / macro_summary / risk_notes[] / procurement_advice
         ↓
[worker] step 3.5 (代码注入 support/resistance · §6.5)：
         → 读 近 20 交易日 CU/LC 主力收盘价
         → computeSupportResistance() 算出 support / resistance（整数）
         → merge into payload_json.{cu,lc}.outlook（不进 LLM）
         ↓
[worker] step 4 (docx 渲染)：
         → 读 briefing_template_fields 映射
         → 用 docxtemplater 填 design/templates/briefing.docx
         → 渲染产物 → MinIO PUT `briefings/YYYY/MM/briefing-YYYYMMDD.docx`
         ↓
[worker] step 5 (落库)：
         → INSERT into commodity_briefings (briefing_date, payload_json, docx_path)
         → 触发 briefing-push job
```

### 5.3 briefing-push job

```
[worker] → 加载 briefing_targets WHERE enabled=true
         → 对每个 target 并发推送（concurrency=3）
         → 钉钉机器人 webhook：actionCard 消息 + 站内深链 `/briefing/[id]`（§10.3）
           （v1.1 MVP 不发 file 消息，详见 §10.4 v1.2 评估）
         → 失败：指数退避 ×3
         → 最终成功/失败状态写 briefing_pushes 表
```

### 5.4 失败重试 / 兜底

| 阶段                        | 重试              | 兜底                                                              |
| --------------------------- | ----------------- | ----------------------------------------------------------------- |
| quotes-fetch 单 source 失败 | 3 次（v1.0 默认） | 该字段标 null，不阻塞其他 source                                  |
| briefing-gen Kimi 调用失败  | 2 次              | 整个 briefing 标 `gen_status=failed` + admin 红色告警；不推送     |
| briefing-gen docx 渲染失败  | 不重试            | 同上                                                              |
| briefing-push 钉钉失败      | 3 次指数退避      | push_status=failed + admin 红色告警；保留 briefing 数据可重新推送 |

---

## 6. LLM 调用与 schema

### 6.1 BRIEFING_SCHEMA（7 段 LLM 产出 · 不含数值字段）

```ts
// packages/llm/src/briefing-schema.ts
export const BRIEFING_SCHEMA = {
  type: "object",
  required: ["cu", "lc", "macro_summary", "risk_notes", "procurement_advice"],
  properties: {
    cu: {
      type: "object",
      required: ["logic_summary", "outlook"],
      properties: {
        logic_summary: { type: "string", maxLength: 400 },
        outlook: {
          type: "object",
          required: ["trend"], // 仅 trend 由 LLM 出
          properties: {
            trend: { enum: ["偏多", "区间震荡", "偏弱"] }
            // support/resistance 不在 LLM schema —— 由 packages/core/briefing.ts 代码计算后
            // 在 worker 装配层注入 commodity_briefings.payload_json.cu.outlook
          }
        }
      }
    },
    lc: {
      /* 同上结构：logic_summary + outlook.trend */
    },
    macro_summary: { type: "string", maxLength: 300 },
    risk_notes: {
      type: "array",
      items: { type: "string", maxLength: 100 },
      maxItems: 5
    },
    procurement_advice: {
      enum: [
        "全面观望，等待价格回落",
        "刚需少量补库，大批量采购暂缓",
        "逢关键支撑位分批锁价备货",
        "严控现有库存，放缓整体备货节奏"
      ]
    }
  }
} as const;
```

**LLM 产出 7 段**（与 `requirements.md §7.2` / §12 验收抽检对齐）：

1. `cu.logic_summary` · 2. `cu.outlook.trend` · 3. `lc.logic_summary` · 4. `lc.outlook.trend` · 5. `macro_summary` · 6. `risk_notes[]` · 7. `procurement_advice`

**代码计算 4 段**（不入 LLM schema）：`cu.outlook.support` / `cu.outlook.resistance` / `lc.outlook.support` / `lc.outlook.resistance`，见 §6.5 公式与注入流程。

### 6.2 System prompt 关键约束

```
你是远东控股的大宗商品分析师。基于以下数值与新闻摘要，输出 JSON。
严格遵守：
1. 任何数字必须来源于"当日数值"或"近 5 日序列"输入，禁止虚构
2. 不输出任何"建议交易"或"投资意见"字样
3. 不输出任何价格数值字段（支撑位/压力位由后端代码计算，不在你的 schema 内）
4. logic_summary 中可引用输入的具体数值，但不得给出未来价位预测
5. 输出严格符合 schema；JSON 解析失败将被丢弃
```

### 6.3 上下文 token 预算

| 字段                                          | 估算            |
| --------------------------------------------- | --------------- |
| 当日 + 近 5 日 quotes 序列                    | ~ 1.5K tokens   |
| 24h 内铜锂相关 items 摘要（≤ 30 条 × ~80 字） | ~ 3.5K tokens   |
| System prompt + schema                        | ~ 1K tokens     |
| **合计 input**                                | **~ 6K tokens** |
| Kimi K2.6 200K 上限                           | 充裕            |

### 6.4 scrubber 集成

调用入口与 `daily-gen` 完全一致：

```ts
const result = await withScrubber(kimi, {
  systemPrompt: BRIEFING_SYSTEM_PROMPT,
  user: buildBriefingInput(quotes, recentItems),
  schema: BRIEFING_SCHEMA
});
```

`withScrubber` 已在 v1.0 实现（`design §5` 阶段 ② + tasks T-M2-15），含命中 PII 阈值跳过 LLM 路径。

### 6.5 支撑位 / 压力位代码计算（不走 LLM）

`packages/core/briefing.ts:computeSupportResistance(series: QuoteSeries): { support: number; resistance: number }`：

- **输入**：近 20 个交易日某合约的主力收盘价数组（来自 `commodity_quotes WHERE metric_key=? ORDER BY observed_at DESC LIMIT 20`）
- **算法**（v1.1 MVP，无需 ML）：
  - `support  = max(min(close[1..20]), pivot - (high20 - low20) * 0.382)`
  - `resistance = min(max(close[1..20]), pivot + (high20 - low20) * 0.382)`
  - `pivot = (high20 + low20 + close[0]) / 3`
- **输出**：整数（万元/吨 或 元/吨，按 metric 单位规则）
- **注入**：worker 装配层（briefing-gen step 3 之后、step 4 docx 渲染之前）把代码计算结果合并入 `payload_json.cu.outlook` / `payload_json.lc.outlook`，再交给 docxtemplater 渲染
- **降级**：若近 20 日序列样本 < 10 → `support=null` / `resistance=null` → docx 渲染走 `briefing_template_fields.fallback_text='—'`
- **UI 降级提示**（v0.4 fix E3）：`support` 或 `resistance` 为 null 时，`/briefing/[id]` 详情页 outlook 卡片下方必须显示提示条「近期数据样本不足，支撑/压力位计算已降级」（节假日连续或信源故障导致 < 10 样本时常见），避免用户误以为「—」是 LLM 输出空。落地见 `tasks.md T-CB-17` constraint。

**纯函数原则**（沿用 v1.0 packages/core 约束）：不依赖 `packages/db`，不调 LLM，单测可覆盖；签名见 `tasks.md T-CB-05`。

---

## 7. 数据模型

### 7.1 新增表

```sql
-- 大宗商品时序数值（NFR-103：保留 365 天）
CREATE TABLE commodity_quotes (
  id            BIGSERIAL PRIMARY KEY,
  metric_key    TEXT NOT NULL,                          -- 如 'cu_main_close' / 'lc_main_close'
  value         NUMERIC(18,4),                          -- NULL 表示拉取失败
  change_pct    NUMERIC(8,4),                           -- 日内涨跌（百分比，0.32 = 0.32%）
  source_id     BIGINT NOT NULL REFERENCES sources(id),
  raw_text      TEXT,                                   -- 脱标文本摘要 ≤2000 **字符**（Unicode code points · v0.4 fix E2 单位歧义；已 strip HTML / NFR-102 审计用；禁止存完整 HTML，沿用 v1.0 FR-12）
  observed_at   TIMESTAMPTZ NOT NULL,                   -- 数据所指向的时间点
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_key, observed_at)
);
CREATE INDEX commodity_quotes_metric_observed_idx ON commodity_quotes (metric_key, observed_at DESC);

-- 简报记录（NFR-103：元数据 90 天，docx 文件随 MinIO retention）
CREATE TABLE commodity_briefings (
  id                BIGSERIAL PRIMARY KEY,
  briefing_date     DATE NOT NULL UNIQUE,               -- 工作日，节假日跳过
  template_version  INT NOT NULL DEFAULT 1,             -- v0.4 fix M1：关联回 design/templates/briefing.docx 版本号，便于按模板版本回溯渲染（不存 payload_json 内便于 SQL 高效查询）
  payload_json      JSONB NOT NULL,                     -- 包含全部字段值 + LLM 输出
  docx_path         TEXT,                               -- MinIO key（briefings/YYYY/MM/...）
  gen_status        TEXT NOT NULL CHECK (gen_status IN ('pending','succeeded','failed','degraded')),
  gen_error         TEXT,                               -- 失败原因
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX commodity_briefings_date_idx        ON commodity_briefings (briefing_date DESC);
CREATE INDEX commodity_briefings_tpl_version_idx ON commodity_briefings (template_version);

-- 推送目标（admin 后台维护）
CREATE TABLE briefing_targets (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,                          -- 显示名（"采购部群"）
  channel       TEXT NOT NULL CHECK (channel IN ('dingtalk_bot')),
  webhook_url   TEXT NOT NULL,                          -- 钉钉机器人 webhook
  sign_secret   TEXT,                                   -- 钉钉加签 secret（可空，则用 IP 白名单）
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at   TIMESTAMPTZ,                            -- v0.4 fix M2：软删时间戳（与 v1.0 users/sources 一致），保留 briefing_pushes 审计链；管理后台"删除"= UPDATE disabled_at=now() + enabled=false
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX briefing_targets_active_idx ON briefing_targets (id) WHERE disabled_at IS NULL;

-- 推送记录
CREATE TABLE briefing_pushes (
  id             BIGSERIAL PRIMARY KEY,
  briefing_id    BIGINT NOT NULL REFERENCES commodity_briefings(id) ON DELETE CASCADE,
  target_id      BIGINT NOT NULL REFERENCES briefing_targets(id) ON DELETE CASCADE,
  push_status    TEXT NOT NULL CHECK (push_status IN ('pending','succeeded','failed')),
  attempt_count  INT NOT NULL DEFAULT 0,
  error_detail   TEXT,
  pushed_at      TIMESTAMPTZ,
  UNIQUE (briefing_id, target_id)
);
CREATE INDEX briefing_pushes_status_idx ON briefing_pushes (push_status, pushed_at DESC);

-- 节假日表（admin 一年一次维护）
CREATE TABLE briefing_holidays (
  holiday_date  DATE PRIMARY KEY,
  name          TEXT NOT NULL,                          -- "国庆节"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 模板字段映射（NFR-107：admin 可后台改）
CREATE TABLE briefing_template_fields (
  placeholder_key  TEXT PRIMARY KEY,                     -- 'cu.price.shfe_main'
  label            TEXT NOT NULL,                        -- '沪铜主力合约'
  source_metric    TEXT,                                 -- commodity_quotes.metric_key（数值字段时）
  llm_path         TEXT,                                 -- 'cu.outlook.support'（LLM 字段时）
  fallback_text    TEXT NOT NULL DEFAULT '—',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT exactly_one_source CHECK (
    (source_metric IS NOT NULL AND llm_path IS NULL) OR
    (source_metric IS NULL AND llm_path IS NOT NULL) OR
    (source_metric IS NULL AND llm_path IS NULL)        -- 静态占位（如页脚声明）
  )
);
```

### 7.2 v1.0 表的唯一破坏性变更

```sql
-- sources.fetcher_type CHECK 扩展（v1.0 仅含 rss/html/playwright）
ALTER TABLE sources
  DROP CONSTRAINT IF EXISTS sources_fetcher_type_check,
  ADD CONSTRAINT sources_fetcher_type_check
    CHECK (fetcher_type IN ('rss','html','playwright','quotes'));
```

**影响评估**：扩展 CHECK 不影响已有行；回滚只需 `ALTER ... DROP/ADD` 反向；详见 `tasks.md T-CB-02 rollback`。

### 7.3 90 / 365 天 retention 实施

- v1.0 cleanup job（`apps/worker/src/jobs/cleanup.ts`）追加两条新 DELETE：
  - `DELETE FROM commodity_quotes WHERE observed_at < now() - INTERVAL '365 days'`
  - `DELETE FROM commodity_briefings WHERE briefing_date < now() - INTERVAL '90 days'`
- briefing_pushes 走 `ON DELETE CASCADE` 跟随 briefings
- briefing_targets / briefing_template_fields / briefing_holidays 为配置型数据，永久（沿用 v1.0 `requirements §12` 永久保留分类）

---

## 8. API 端点（增量）

| Method | Path                             | 说明                                                                                                                                                         | 权限    |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| GET    | `/api/briefing?cursor=`          | 列表（按 briefing_date desc）                                                                                                                                | viewer+ |
| GET    | `/api/briefing/:id`              | 详情（含 payload_json + 推送状态）                                                                                                                           | viewer+ |
| GET    | `/api/briefing/:id/download`     | 下载 docx 二进制流；MinIO 已 retention 清理（briefing_date < now-90d 或 docx_path 取不到对象）→ **410 Gone**（不返 404，对齐 FR-110）；briefing 不存在 → 404 | viewer+ |
| POST   | `/api/briefing/:id/regenerate`   | 重新生成（触发 briefing-gen）                                                                                                                                | editor+ |
| POST   | `/api/briefing/:id/repush`       | 重新推送                                                                                                                                                     | admin   |
| GET    | `/api/briefing/targets`          | 列出推送目标                                                                                                                                                 | admin   |
| POST   | `/api/briefing/targets`          | 新增目标                                                                                                                                                     | admin   |
| PUT    | `/api/briefing/targets/:id`      | 改目标                                                                                                                                                       | admin   |
| DELETE | `/api/briefing/targets/:id`      | 删目标                                                                                                                                                       | admin   |
| POST   | `/api/briefing/targets/:id/test` | 测试推送（发一条测试消息）                                                                                                                                   | admin   |

**FR-110 / 410 Gone 实现要点**：

- handler 先查 `commodity_briefings WHERE id=?` → 不存在返 404（沿用 v1.0 详情防枚举 pattern，不区分"不存在"和"被清"）
- 命中后判 `briefing_date < now() - INTERVAL '90 days'` 或 MinIO `headObject(docx_path)` 404 → 返 **410 Gone** + `{ error: { code: 'BRIEFING_DOCX_EXPIRED', message: '简报已过保留期' } }`
- 站内详情页 `/briefing/[id]` 同样区分：≤90 天显示"下载 docx"按钮；>90 天显示"已过保留期"灰态文案
- 该端点为公开下载入口，actionCard 站内深链最终跳转点；不走 MinIO 直连 URL（避免凭据/穿透问题）

约定（沿用 v1.0 §9）：

- JSON 字段 camelCase
- 错误结构 `{ error: { code, message, details? } }`
- 分页 `cursor`

---

## 9. docx 渲染策略

### 9.1 模板放置

`design/templates/briefing.docx`（与 v1.0 design/\*.html 同目录，纳入 git；模板是配置，不是生成产物）。

### 9.2 占位符语法

用 docxtemplater 默认 `{{...}}` 语法。表格行 / 段落均支持。模板中所有 `{{key}}` 必须能在 `briefing_template_fields` 表里找到，否则启动期 lint 报错（T-CB-13）。

### 9.3 渲染失败处理

- 缺失占位符 → 用 `fallback_text` 字段（默认 "—"）
- docxtemplater 异常（模板损坏 / 占位符无效）→ 整个 briefing 标 `gen_status=failed`，admin 红色告警

### 9.4 模板版本化

模板首行加 `{{template_version}}` 占位符；改模板必须同步 bump 版本，便于 `commodity_briefings.payload_json` 关联回模板版本（用于历史回看时正确渲染）。

---

## 10. 钉钉群机器人推送实现

### 10.1 SDK 封装

`apps/worker/src/lib/dingtalk-bot.ts` 提供：

```ts
export interface DingtalkBotMessage {
  msgType: "actionCard" | "text" | "markdown";
  title: string;
  text: string;
  singleTitle?: string;
  singleURL?: string;
}

export async function sendDingtalkBot(
  webhookUrl: string,
  signSecret: string | null,
  message: DingtalkBotMessage
): Promise<{ ok: boolean; errcode?: number; errmsg?: string }>;
```

### 10.2 加签实现

```
timestamp = Date.now()
string_to_sign = `${timestamp}\n${signSecret}`
hmac = HmacSHA256(string_to_sign, signSecret) → base64 → urlencode
final_url = `${webhookUrl}&timestamp=${timestamp}&sign=${sign}`
```

### 10.3 默认消息体

actionCard 类型（站内深链方案，避免 MinIO 公网穿透问题，Q-11K 兜底）：

```json
{
  "msgtype": "actionCard",
  "actionCard": {
    "title": "远东·铜锂行情简报 · 2026-05-19",
    "text": "## 远东·铜锂行情简报 · 2026-05-19\n\n沪铜主力 78,520 (+0.32%)\n碳酸锂主力 87,400 (-1.15%)\n\n趋势研判：CU 偏多 / LC 区间震荡\n\n详情见站内简报。",
    "singleTitle": "查看完整简报",
    "singleURL": "https://fe-radar.internal/briefing/123"
  }
}
```

### 10.4 文件推送（v1.1 不实现，v1.2+ 评估）

钉钉**自定义机器人不支持原生 file 消息**，需走企业内部机器人 API + 文件上传链路，工程量大且依赖管理员审批 / IP 白名单 / 凭据托管。v1.1 MVP 统一走 §10.3 actionCard + 站内深链方案：

- 用户点击 actionCard 跳 `/briefing/[id]` 详情页
- 详情页"下载 docx"按钮调 `GET /api/briefing/:id/download`（见 §8 API 表）
- 用户凭已登录态（Auth.js cookie）下载，**不暴露 MinIO 公网**

v1.2+ 若需要群内直发 docx，单独 task 评估企业机器人接入；当前 design 不预留 file 推送代码路径，避免半成品。

---

## 11. 部署拓扑（stack.yml 增量）

```yaml
# deploy/stack.yml 追加（v1.0 已有服务不变）
services:
  rsshub:
    image: diygod/rsshub:latest
    deploy: { replicas: 1, restart_policy: { condition: any } }
    environment:
      TZ: Asia/Shanghai
      CACHE_EXPIRE: 3600
      NODE_ENV: production
    networks: [internal]
    # 仅内网暴露，不映射到主机
```

worker / web 已有的 environment 追加：

```yaml
worker:
  environment:
    # ... v1.0 已有 ...
    RSSHUB_BASE_URL: http://rsshub:1200
    BRIEFING_TEMPLATE_PATH: /app/design/templates/briefing.docx
    BRIEFING_MINIO_BUCKET: fe-radar-briefings
```

资源补充：rsshub 256 MB / 0.1 核（与 redis 同级）。

---

## 12. 测试策略

| 层         | 测试                                                                           | 工具                         |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------- |
| 单元       | `briefing-render` / `dingtalk-bot` 加签 / `briefing.ts` 涨跌计算               | Vitest（沿用 v1.0）          |
| 单元       | 每个 adapter（shfe/gfex/lme/pboc/chinabond/rsshub-extract）正常 + 异常 fixture | Vitest + 真实响应 fixture    |
| 集成       | quotes-fetch job 全链：mock adapter → commodity_quotes 入库                    | Vitest + 测试 Postgres       |
| 集成       | briefing-gen job：mock Kimi → docx 渲染 → MinIO（用 minio test 容器）          | Vitest                       |
| E2E        | `/briefing` 列表 + `/briefing/[id]` 详情 + admin targets CRUD                  | Playwright（沿用 v1.0 e2e/） |
| 端到端烟雾 | 节假日跳过 / 字段缺失降级 / 推送失败重试                                       | release smoke spec 追加      |

---

## 13. 关键风险与缓解

| #   | 风险                                                 | 缓解                                                                                                             |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | 上期所 / 广期所页面改版导致 adapter 失效             | 每 adapter 单测 fixture + 失败连续 3 日触发红色告警；admin 可禁用单 source 不阻塞简报                            |
| 2   | RSSHub 公共 route 失效或被目标站封锁                 | 自部署 + Redis 缓存（CACHE_EXPIRE=3600）；关键 route 在 PR 中 pin 镜像版本                                       |
| 3   | LLM 输出 schema 不合规 / 出现幻觉数值                | structured output + JSON schema 强制；解析失败丢弃整次生成 + 黄色告警                                            |
| 4   | 钉钉机器人 webhook 凭据泄漏                          | `briefing_targets.sign_secret` 字段在 `users.role != admin` 时 API 返回 mask；audit log 写入 access              |
| 5   | 16:00 推送时上期所夜盘未收，价格不完整               | Q-11I v0.3 决策**接受 16:00 日盘版**；模板字段加注"日盘收盘价 · 夜盘见次日简报"；夜盘版（21:30）推迟到 v1.2 评估 |
| 6   | 节假日表手工维护漏录 → 节假日推送了"空"简报          | gen 前检查当日 quotes 入库行数 < 5 → 直接 abort + 告警；不发空简报                                               |
| 7   | docx 模板被 admin 误改导致渲染失败                   | 启动期 lint 校验占位符 vs briefing_template_fields；模板纳入 git 不允许运行时上传                                |
| 8   | Kimi 月度成本超 100 元                               | 接 v1.0 NFR-05 总预算监控；单次 token 上限 8K input + 1K output                                                  |
| 9   | sources.fetcher_type CHECK 扩展失败（rollback 风险） | migration 用 `ALTER ... DROP/ADD CONSTRAINT`；rollback 路径在 T-CB-02 acceptance 已定义                          |
| 10  | quotes 365 天保留导致表膨胀                          | 估算：~30 metric × 250 工作日 = 7500 行/年；index 命中良好，不需要分区                                           |

---

## 14. 安全与权限（沿用 v1.0 §13）

- 仅内网访问
- `/admin/briefing/*` 必须 RBAC admin
- `/briefing` 列表 / 详情对 viewer+ 开放
- 钉钉 webhook URL 不出现在前端响应（API 层 mask）
- 所有 admin 操作写 v1.0 已有 `audit_logs` 表（reuse）

---

## 15. 监控与运维（沿用 v1.0 §14 Grafana）

Dashboard 新增面板：

- briefing-gen 成功率（24h）
- briefing-push 成功率（24h）
- BRIEFING_SCHEMA 7 段当日覆盖率（cu/lc logic_summary + trend、macro_summary、risk_notes、procurement_advice）
- quotes-fetch P50/P99 时延
- Kimi 月度调用量与成本

告警规则：

- briefing-gen 连续 2 日失败 → 红色
- briefing-push 当日失败率 > 50% → 红色
- 第一层字段连续 3 工作日缺失 → 红色
- RSSHub 容器 health 失败 → 红色

---

## 16. 测试 / 验收门槛

与 `requirements §12` 验收标准一一对齐。代码层 acceptance gate（与 v1.0 一致）：

- `pnpm -r typecheck` ✅
- `pnpm -r lint` ✅
- `pnpm -r test` ✅
- `pnpm -r build` ✅
- `pnpm madge --circular apps packages` ✅
- v1.1 新增 e2e（briefing / targets / 重新推送）✅
- 与 v1.0 兼容回归（v1.0 已有 86 tests 不挂） ✅

---

## 17. 后续动作

1. ✅ 用户评审 requirements v0.1 → v0.2 → **v0.3** (Q-11G/H/I/J/L 全部决策内化 · 2026-05-19)
2. 用户评审 design v0.1
3. 产出 `tasks.md`（同目录）
4. 提交 Antigravity Plan Review
5. Fix Plan（如有 Critical）
6. 建 Linear DMA issue（codex label · Urgent · Blocked by v1.0 release tag）
7. 等 v1.0.0 GA 完成 → Codex Execute v1.1
