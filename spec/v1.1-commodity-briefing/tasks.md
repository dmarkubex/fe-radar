# FE-Radar v1.1 — Commodity Briefing Tasks (v0.4)

> **状态**：APPROVED-with-conditions（Antigravity Plan Review [DMA-153](https://linear.app/dmarkubex/issue/DMA-153) 2026-05-19 · 3 Minor + 4 Edge 已闭合）· 与 `requirements.md` v0.3 / `design.md` v0.4 配对
> **基础依赖**：v1.0 `spec/requirements.md` v0.8 + `spec/design.md` v0.8 + `spec/tasks.md` v0.3（M0–M5 全部 Done）+ `.ai/shared/style-invariants.md` v1.0
> **Linear**：28 issue 已建（DMA-151..178 · 39 条 blockedBy · `.ai/linear/v1.1-issue-map.json`）
> **作者**：Claude Code（Plan Stage 产出 · Plan-Fix 闭合 v0.4）
> **格式**：每条 task 严格遵循 `.ai/shared/task-template.md`
> **v0.3 → v0.4 修复点**（DMA-153 review report `.ai/linear/v11-plan-review-report.md`）：
>   - **M1**：design.md §7.1 `commodity_briefings.template_version`（schema 改动，task T-CB-01 已自动覆盖 6 张表全口径）
>   - **M2**：design.md §7.1 `briefing_targets.disabled_at`（schema 改动；T-CB-18 的「删除走软确认」由对应 API/UI 实现 UPDATE disabled_at = now()）
>   - **M3**：T-CB-09 upsert 增 Tier 优先级保护（T1 > T2 > T3 · ON CONFLICT DO UPDATE WHERE EXCLUDED.tier <= current.tier）
>   - **E1**：T-CB-13 precheck 增 quotes-fetch 队列陈旧度检查（waiting/active > 0 → 延迟重试 ×2）
>   - **E2**：T-CB-01 `raw_text` 单位统一为 **2000 字符**（已在 v0.3 落地，本轮再次校对一致）
>   - **E3**：T-CB-17 详情页对 support/resistance=null 增 UI 降级提示条
>   - **E4**：T-CB-03 标注 seed 仅用于首次初始化，admin 后台改后不再 overwrite（已 ON CONFLICT DO NOTHING）+ migration 序号即 seed_version 审计
> **v0.2 → v0.3 变更**：5 项 Human-decision 内化（Q-11G/H/I/J/L · requirements §11.1）· 风险 R5 (16:00 夜盘) 措辞对齐 · 后续动作清单更新
> **v0.1 → v0.2 修复点**：T-CB-01 6 张表口径 / T-CB-02 含 sources-schema.ts + admin UI 扩展 / T-CB-05 + computeSupportResistance / T-CB-10 schema 7 段去数值 / T-CB-13 step 3.5 注入 / T-CB-16 download 端点 + 410 Gone / T-CB-17 410 对齐 / T-CB-18 quote 引号修复

---

## 0. Sub-Agent 分工（沿用 v1.0 8 agent）

| Agent | 本模块职责 | 本模块 scope |
|---|---|---|
| `agent-infra` | RSSHub 自部署 / stack.yml diff / Grafana 面板 / cleanup 扩展 | `deploy/stack.yml` / `deploy/rsshub/` / Grafana provisioning / `apps/worker/src/jobs/cleanup.ts`（追加 v1.1 DELETE）|
| `agent-db` | 新 schema / migration / seed | `packages/db/src/schema-commodity.ts`（**新增平级文件，不动 v1.0 `schema.ts`**）· `packages/db/migrations/0008_*.sql` · `packages/db/migrations/0009_*.sql` · `packages/db/scripts/seed-commodity-*.ts` |
| `agent-llm` | BRIEFING_SCHEMA + system prompt + Kimi 集成 | `packages/llm/src/briefing-schema.ts` · `packages/llm/src/index.ts`（导出） |
| `agent-core` | briefing 纯函数（涨跌计算 / 字段映射 / 节假日判定） | `packages/core/src/briefing.ts` · `packages/core/src/__tests__/briefing.test.ts` |
| `agent-worker` | quotes-fetch / briefing-gen / briefing-push jobs + adapters + scheduler | `apps/worker/src/fetchers/quotes/**` · `apps/worker/src/jobs/quotes-fetch.ts` · `apps/worker/src/jobs/briefing-gen.ts` · `apps/worker/src/jobs/briefing-push.ts` · `apps/worker/src/lib/{briefing-render,dingtalk-bot}.ts` · `apps/worker/src/scheduler.ts`（追加 cron） |
| `agent-web-api` | /api/briefing/* Route Handlers + Zod schema | `apps/web/app/api/briefing/**` |
| `agent-web-ui` | /briefing 列表 + 详情 + admin targets 页 + 顶部导航增项 | `apps/web/app/briefing/**` · `apps/web/app/(admin)/admin/briefing/**` · `apps/web/components/briefing/**` · 顶导文件（仅追加链接） |
| `agent-auth` | 本模块不涉及 | — |

**并行安全（沿用 v1.0 约束）**：
- 每个 task scope ≤ 1 agent；多 agent 协作的功能拆 a/b 子 task
- 跨 agent 接口先由 `agent-core` / `packages/shared` 定义类型，再各自实现
- 同一 milestone 内**同一文件**禁止两个 task 并发

---

## 1. Milestone 概览（v1.1 三阶段）

| Phase | 主题 | 目标日期 | task 数 | 关键 sub-agent |
|---|---|---|---|---|
| V11-P1 | 数据通路（schema / RSSHub / quotes fetcher / 应用层 quotes 校验） | 2026-06-15 | 9 | db / infra / worker / core / web-api / web-ui |
| V11-P2 | 简报生成与推送（LLM / docx / 钉钉机器人） | 2026-06-26 | 7 | llm / worker / core |
| V11-P3 | 前端 / 后台 / 监控 / 验收 | 2026-07-05 | 6 | web-ui / web-api / infra |
| **合计** | | | **22** | |

**前置依赖**：v1.0 release tag v1.0.0 GA（build-server smoke + Antigravity Gate 2 + Grafana 告警 + MinIO restore + Docker Swarm 部署完成）。v1.1 不与 v1.0 release 并行执行。

**跨 phase 依赖图**：
```
V11-P1 (data path)                          →  V11-P2 (briefing & push)  →  V11-P3 (UI & accept)
  T-CB-01 / 02a / 02b / 03..08 (9 tasks)       T-CB-09..T-CB-15              T-CB-16..T-CB-21
```
T-CB-02b 依赖 T-CB-02a，其余可按 sub-agent 并行（详见各 task `depends_on`）。

---

## 2. V11-P1 · 数据通路（2026-06-15）

### T-CB-01 commodity schema 初版

```yaml
task: T-CB-01
  goal: "实现 design.md §7.1 全部 6 张新表（commodity_quotes / commodity_briefings / briefing_targets / briefing_pushes / briefing_holidays / briefing_template_fields）的 Drizzle schema 定义"
  constraints:
    - "禁止字符串拼 SQL"
    - "全部 timestamp 用 TIMESTAMPTZ"
    - "commodity_quotes UNIQUE (metric_key, observed_at)"
    - "commodity_quotes.raw_text 字段 Drizzle 类型 text() · 应用层写入前必须 strip HTML 且截断 ≤2000 字符（沿用 v1.0 FR-12 不存原始 HTML 快照硬约束 · 见 design.md §4.3）"
    - "commodity_briefings.briefing_date UNIQUE"
    - "briefing_pushes.briefing_id ON DELETE CASCADE / UNIQUE (briefing_id, target_id)"
    - "briefing_template_fields 必须含 exactly_one_source CHECK"
    - "不修改 v1.0 已有 schema 文件"
  ask_agent_first:
    - "restate design.md §7.1 schema 与 v1.0 schema 命名风格（v1.0 用单文件 packages/db/src/schema.ts）"
    - "outline schema 文件结构（新增平级 schema-commodity.ts，不污染 schema.ts）"
    - "list 索引（commodity_quotes_metric_observed_idx / briefing_pushes_status_idx）"
    - "list 测试（drizzle generate snapshot + migration 在测试库跑通）"
  owner: "agent-db"
  scope:
    - "packages/db/src/schema-commodity.ts"
    - "packages/db/src/index.ts (追加 export，不改 v1.0 既有 export)"
  rollback: "revert PR；schema 文件独立无 cross-file 依赖"
  acceptance:
    - "drizzle-kit generate 产物与 schema 一致"
    - "pnpm -r typecheck 全绿"
    - "新增 6 张表能通过 schema.ts 导出"
    - "v1.0 已有 schema 文件 git diff = 0"
```

### T-CB-02a migration 0008 + sources.fetcher_type CHECK 扩展

```yaml
task: T-CB-02a
  goal: "落地 0008_commodity_briefing.sql migration（v1.0 已用到 0007_users_merge.sql，v1.1 起 0008），含 6 张新表 + sources.fetcher_type CHECK 扩展为 (rss/html/playwright/quotes)"
  constraints:
    - "用 ALTER CONSTRAINT 不要 DROP 整张表"
    - "新表 CREATE 后必须能在空库连续跑两次 idempotent（IF NOT EXISTS）"
    - "rollback SQL 必须一同提交（reverse migration）"
    - "禁止修改 v1.0 已有 migration 文件（含 0001..0007）"
  ask_agent_first:
    - "restate v1.0 sources.fetcher_type CHECK 当前 SQL（packages/db/migrations/0001_init.sql:11）"
    - "outline DROP CONSTRAINT + ADD CONSTRAINT 顺序与原子性"
    - "list 测试（空库跑通 + 有数据库测试 sources 表 rows 不丢）"
    - "list rollback 验证步骤"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0008_commodity_briefing.sql"
    - "packages/db/migrations/0008_commodity_briefing.down.sql (rollback)"
  rollback: "drizzle-kit migrate down 0008；CHECK 反向 ALTER"
  acceptance:
    - "drizzle-kit migrate up 在空库 + 有 v1.0 数据库均成功"
    - "v1.0 既有 sources 行不丢、不动 fetcher_type 值"
    - "psql \\d+ commodity_quotes 显示全部约束与索引"
    - "drizzle-kit migrate down 0008 也能跑通"
```

### T-CB-02b 应用层 quotes 类型校验与 admin UI 扩展（修复 review #5）

```yaml
task: T-CB-02b
  goal: "扩展应用层 Zod schema 与 admin sources 表单，让 fetcher_type='quotes' 能经现有 admin /api/sources + /admin/sources 路径管理（否则 DB CHECK 扩展形同虚设）"
  constraints:
    - "apps/web/lib/api/sources-schema.ts 当前 fetcherType enum 仅含 rss/html/playwright（line 4），必须扩展为 + 'quotes'"
    - "discriminated union 必须加 quotes case：sources.config 对 fetcher_type='quotes' 校验 {adapter: enum, metric_keys: string[], endpoint: string, retry: {max, backoffMs}, regex_rules?: [...]}（与 design.md §4.1 config 形状一致）"
    - "admin sources 表单（apps/web/app/(admin)/admin/sources/source-form.tsx）必须能选 'quotes' 类型并显示对应 config 字段；adapter 用 select（shfe/gfex/lme/pboc/chinabond/rsshub-extract）；metric_keys 用 tag input"
    - "禁止破坏 v1.0 rss/html/playwright 三个 case 的字段渲染与校验"
    - "不能让 admin 把 v1.0 已有信源 fetcher_type 改成 quotes（UI 编辑时禁用类型切换）"
  ask_agent_first:
    - "restate apps/web/lib/api/sources-schema.ts 当前 fetcherType + discriminated union 形状"
    - "restate apps/web/app/(admin)/admin/sources/source-form.tsx 当前类型选择 UI 与 config 字段渲染方式"
    - "outline Zod schema 扩展方案（不破坏 v1.0 case）"
    - "outline admin UI 新增 quotes 字段表单组件"
    - "list 测试（Zod 单测 + Playwright admin 新建 quotes source e2e）"
  owner: "agent-web-api + agent-web-ui (协作；先 web-api 出 schema，web-ui 接 UI)"
  scope:
    - "apps/web/lib/api/sources-schema.ts (扩展 fetcherType enum + quotes case discriminated union)"
    - "apps/web/lib/api/__tests__/sources-schema.test.ts (新增 quotes payload 用例)"
    - "apps/web/app/(admin)/admin/sources/source-form.tsx (UI 新增 quotes 类型字段)"
    - "apps/web/e2e/admin-sources-quotes.spec.ts (新增 quotes e2e)"
  rollback: "revert PR；DB CHECK 已含 quotes 不影响 v1.0 rss/html/playwright CRUD"
  acceptance:
    - "Zod schema 单测：fetcher_type='quotes' + 合法 config payload → parse 成功；非法 adapter / 缺 metric_keys / 缺 endpoint → parse 失败带详细 path"
    - "admin UI e2e：admin 登录后能在 /admin/sources 新建 1 条 fetcher_type='quotes' 的信源（adapter=shfe，metric_keys=[cu_main_close]），列表中正确显示"
    - "v1.0 rss/html/playwright 信源 CRUD e2e 无回归"
    - "type=password / sign_secret 等敏感字段渲染不变（与 T-CB-18 admin/briefing/targets 共享同套表单约定）"
  depends_on: "T-CB-02a (DB CHECK 必须先扩展，Zod 才能写 quotes 而不被数据库回写时拒绝)"
```

### T-CB-03 commodity seed（信源 + 节假日 + 模板字段）

```yaml
task: T-CB-03
  goal: "落地 0009 seed migration：v1.1 信源（§5）+ 2026 节假日表 + 默认 briefing_template_fields 映射"
  constraints:
    - "ON CONFLICT DO NOTHING（idempotent）"
    - "v0.4 fix E4：seed **仅用于首次初始化**；admin 后台对 briefing_template_fields 的改动必须保留（DO NOTHING 已保证不被 reseed 覆盖）；seed 文件 header 注释必须显式声明此约定 + migration 序号即为 seed_version 审计入口，禁止后续直接修改 0009 文件，新增字段须通过新的 migration（0010+）补"
    - "信源 seed 默认 enabled=true 但 fetcher_type='quotes' 的项需要等 adapter 上线再 enable（默认 enabled=false）"
    - "节假日表只放 2026 年 11 个法定节假日（admin 后续每年维护）"
    - "briefing_template_fields seed 与 §7.1 占位符命名一致"
    - "不能放 seed.local.sql"
  ask_agent_first:
    - "restate §5 信源清单与 placeholder 命名"
    - "outline seed 拆分（sources / holidays / template_fields 是否同一个 migration 文件）"
    - "list 测试方法（SELECT count(*) 验证）"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0009_commodity_seed.sql"
    - "packages/db/scripts/seed-commodity.ts (可选 TS 脚本，用于本地 dev)"
  rollback: "DELETE FROM sources WHERE fetcher_type='quotes'; DELETE FROM briefing_holidays; DELETE FROM briefing_template_fields;"
  acceptance:
    - "migration 跑后 sources 表多 12 行（§5）"
    - "briefing_holidays 11 行"
    - "briefing_template_fields ≥ 40 行（覆盖 docx 全部占位符）"
    - "重跑 migration 不重复插入"
```

### T-CB-04 RSSHub 自部署

```yaml
task: T-CB-04
  goal: "deploy/stack.yml 追加 rsshub 服务（diygod/rsshub:latest），内网 only，Redis 缓存"
  constraints:
    - "不映射主机端口（仅 networks: [internal]）"
    - "TZ=Asia/Shanghai 注入"
    - "不影响 v1.0 已有服务（diff 仅追加 rsshub 块 + worker environment 追加 RSSHUB_BASE_URL）"
    - "镜像版本必须 pin 到具体 digest，不用 :latest 飘移"
  ask_agent_first:
    - "restate v1.0 stack.yml networks/资源分配"
    - "outline rsshub 镜像选择 + 资源配额"
    - "list 健康检查方式（curl http://rsshub:1200/healthz）"
    - "list 测试（Swarm 起停 / RSS feed 命中）"
  owner: "agent-infra"
  scope:
    - "deploy/stack.yml"
    - "deploy/README.md (新增 rsshub 启动说明)"
  rollback: "stack.yml revert rsshub 块；docker stack deploy 重新 apply"
  acceptance:
    - "docker stack deploy 后 rsshub 容器 running"
    - "在 worker 容器内 curl rsshub:1200/smm/news/cu 返回 RSS XML"
    - "rsshub 容器无端口暴露到主机"
    - "v1.0 已有服务不受影响（健康检查全绿）"
```

### T-CB-05 packages/core briefing 纯函数

```yaml
task: T-CB-05
  goal: "实现涨跌计算 / 模板字段映射 / 节假日判定 / 字段缺失降级 / 支撑位压力位计算的纯函数"
  constraints:
    - "禁止依赖 packages/db（保持 core 纯函数原则，v1.0 硬约束）"
    - "dayjs 必须用 packages/shared/dayjs（Asia/Shanghai 已注入）"
    - "isBusinessDay(date, holidaySet) 用集合查询；不要在函数内查 DB"
    - "computeSupportResistance(series) 输入近 20 交易日 close[] + high[] + low[]，输出 { support, resistance }（整数，按 design.md §6.5 公式 pivot ± 0.382 × range）；样本 < 10 → 返 { support: null, resistance: null }"
    - "纯函数禁用 LLM / 网络 / 文件 IO"
    - "Vitest 覆盖率 ≥ 90%"
  ask_agent_first:
    - "restate v1.0 packages/core 现有函数风格（scoring.ts / cluster.ts）"
    - "restate design.md §6.5 公式（pivot = (high20 + low20 + close[0])/3；support/resistance ± 0.382 × range）"
    - "outline 5 个主函数签名（computeChangePct / mapPlaceholders / isBusinessDay / coalesceField / computeSupportResistance）"
    - "list 测试用例（涨跌 / 跨日 / 节假日 / 空值降级 / s/r 整数 + 样本不足降级）"
  owner: "agent-core"
  scope:
    - "packages/core/src/briefing.ts"
    - "packages/core/src/index.ts (追加 export)"
    - "packages/core/src/__tests__/briefing.test.ts"
  rollback: "revert PR；尚未被 worker 引用"
  acceptance:
    - "Vitest 覆盖率 ≥ 90%"
    - "isBusinessDay(2026-06-08, holidays={2026-06-08}) === false"
    - "computeChangePct(78520, 78268) ≈ 0.32"
    - "computeSupportResistance(fixture: 近 20 日 CU 序列) 输出整数 support < resistance；样本 = 8 → 两值均为 null"
    - "madge --circular packages/core 无循环"
```

### T-CB-06 quotes fetcher 基座 + types

```yaml
task: T-CB-06
  goal: "实现 quotes fetcher 基座（QuotesAdapter 接口 + dispatcher），与 rss/html/playwright fetcher 并列"
  constraints:
    - "新增 fetcher_type='quotes' 的 dispatcher 入口在 apps/worker/src/fetchers/index.ts（追加 case，不改其他 case）"
    - "QuotesAdapter 接口 + QuoteSample 类型放在 fetchers/quotes/types.ts"
    - "Adapter 失败必须返回 [] 不抛异常；异常由上层捕获并 markSourceFailure"
    - "禁止在 fetcher 层调 LLM（NFR-102 数值精度敏感）"
  ask_agent_first:
    - "restate apps/worker/src/fetchers/{rss,html,playwright}.ts 的接口契约"
    - "outline dispatcher 路由方式"
    - "list 测试方法（mock adapter / 异常路径）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/quotes.ts (dispatcher)"
    - "apps/worker/src/fetchers/quotes/types.ts"
    - "apps/worker/src/fetchers/index.ts (追加 case)"
    - "apps/worker/src/fetchers/__tests__/quotes.test.ts"
  rollback: "revert PR；其他 fetcher 不受影响"
  acceptance:
    - "Vitest 覆盖率 ≥ 85%"
    - "Mock adapter 跑通端到端"
    - "dispatcher 对未知 adapter 名称 throw FETCH_ADAPTER_UNKNOWN"
    - "v1.0 fetcher 测试不挂"
```

### T-CB-07 quotes adapters 第一批（shfe / gfex / lme）

```yaml
task: T-CB-07
  goal: "实现 3 个 T1 数值源 adapter（上期所 / 广期所 / LME），覆盖沪铜主力 / 广期所碳酸锂主力 / 仓单 / LME 伦铜"
  constraints:
    - "每个 adapter 用真实 fixture 写 fetch 测试（fixture 存 __tests__/fixtures/）"
    - "禁止用 LLM 抽数值"
    - "解析失败必须保留 raw_text；raw_text 已 strip HTML 标签 + 截断 ≤2000 字符（沿用 v1.0 FR-12 / design.md §4.3）"
    - "走 v1.0 已有 http.ts（含 proxy 池 + UA 池 + robots）"
    - "同站请求 ≥ 1s 间隔"
  ask_agent_first:
    - "restate 3 个交易所页面/接口的 HTML/JSON 结构"
    - "outline adapter 实现策略（HTML 用 cheerio / JSON 直接 parse）"
    - "list 异常路径（页面改版 / 网络超时 / 字段不存在）"
    - "list 测试 fixture 与 mock 策略"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/quotes/shfe.ts"
    - "apps/worker/src/fetchers/quotes/gfex.ts"
    - "apps/worker/src/fetchers/quotes/lme.ts"
    - "apps/worker/src/fetchers/quotes/__tests__/*.test.ts"
    - "apps/worker/src/fetchers/quotes/__tests__/fixtures/**"
  rollback: "revert PR；commodity_quotes 表中相关 metric_key 行可保留（不影响）"
  acceptance:
    - "Vitest 全绿（3 adapter × 2 测试 = 6 用例最少）"
    - "fixture 解析输出与预期 QuoteSample[] 完全一致"
    - "网络异常路径返回空数组 + 不抛异常"
    - "TypeScript strict 模式无 any"
```

### T-CB-08 quotes adapters 第二批（pboc / chinabond / rsshub-extract）

```yaml
task: T-CB-08
  goal: "实现央行汇率中间价 / 中国货币网 10Y 国债 / RSSHub 数值正则抽取 3 个 adapter"
  constraints:
    - "rsshub-extract 用 sources.config.regex_rules 数组逐条尝试匹配"
    - "正则未命中必须 value=null 并保留 raw_text，禁止 LLM fallback"
    - "raw_text 写入前必经 sanitize-html strip 标签 + 截断 ≤2000 字符（沿用 v1.0 FR-12 / design.md §4.3；禁止存原始 HTML）"
    - "央行 / 货币网 走 html fetcher 基座"
    - "命中失败连续 3 日 → enqueue admin 黄色告警（NFR-104 监控对接）"
  ask_agent_first:
    - "restate 央行中间价页面与中国货币网页结构"
    - "outline regex_rules 命名与优先级"
    - "list 测试 fixture 来源"
    - "list 异常路径（HTML 变更 / 正则失效）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/quotes/pboc.ts"
    - "apps/worker/src/fetchers/quotes/chinabond.ts"
    - "apps/worker/src/fetchers/quotes/rsshub-extract.ts"
    - "apps/worker/src/fetchers/quotes/__tests__/*.test.ts"
    - "apps/worker/src/fetchers/quotes/__tests__/fixtures/**"
  rollback: "revert PR"
  acceptance:
    - "3 adapter Vitest 全绿"
    - "regex 未命中样本测试中 value=null 不抛异常"
    - "rsshub-extract 至少覆盖 SMM 铜 / SMM 锂 / 生意社纯碱 3 个真实 fixture"
```

---

## 3. V11-P2 · 简报生成与推送（2026-06-26）

### T-CB-09 quotes-fetch job 上线

```yaml
task: T-CB-09
  goal: "实现 quotes-fetch BullMQ job + scheduler cron（工作日 15:30），把全部 quotes adapter 端到端串起来写入 commodity_quotes"
  constraints:
    - "并发=5（沿用 v1.0 FETCH_CONCURRENCY）"
    - "失败计入 sources.fail_count，连续 7 失败自动 disable（沿用 v1.0 DISABLE_AFTER_FAIL_DAYS）"
    - "upsert by UNIQUE (metric_key, observed_at)"
    - "v0.4 fix M3：upsert 必须带 Tier 优先级保护，**禁止低优先级源覆盖高优先级源**。SQL pattern：`INSERT ... ON CONFLICT (metric_key, observed_at) DO UPDATE SET value=EXCLUDED.value, change_pct=EXCLUDED.change_pct, source_id=EXCLUDED.source_id, raw_text=EXCLUDED.raw_text, fetched_at=now() WHERE EXCLUDED_source.tier <= current_source.tier`（T1=1 / T2=2 / T3=3，数值越小越高）。SHFE/GFEX/LME/PBoC/ChinaBond 等官方源压制 SMM/生意社 RSSHub 抽数路径，防 flickering"
    - "tier 取值来自 sources.tier；job 需在 upsert 子查询里 JOIN sources 拿到 EXCLUDED 与 current 的 tier，避免低 tier 源在毫秒级时间差内覆盖高 tier 源已写入的值"
    - "节假日跳过（先调 packages/core isBusinessDay）"
    - "禁止在 job 内调 LLM"
  ask_agent_first:
    - "restate v1.0 fetcher job 结构（apps/worker/src/runner.ts）"
    - "outline cron 添加方式（追加到 scheduler.ts，不改现有）"
    - "list 测试（mock dispatcher / DB upsert / 节假日跳过 / 失败 fail_count）"
    - "list 监控指标"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/quotes-fetch.ts"
    - "apps/worker/src/scheduler.ts (追加 cron)"
    - "apps/worker/src/queues.ts (追加 quotes-fetch queue)"
    - "apps/worker/src/__tests__/quotes-fetch.test.ts"
  rollback: "禁用 quotes-fetch cron entry + revert PR"
  acceptance:
    - "测试 Postgres 端到端：mock adapter → upsert → SELECT 验证"
    - "节假日测试：当日 holiday → job return 0 rows"
    - "失败注入：单 adapter throw → fail_count++，其他 source 不受影响"
    - "v0.4 fix M3 Tier 优先级测试：(a) 先写入 T2 (SMM) value=68500 → 后写入 T1 (SHFE) value=68450 → 行最终 value=68450 + source_id=SHFE id；(b) 先写入 T1 value=68450 → 后写入 T2 value=68500 → 行最终保持 value=68450 + source_id=SHFE id（T2 被压制）；(c) 同 tier 后写入覆盖前写入（last-write-wins 兜底）"
    - "v1.0 fetcher job 测试不挂"
```

### T-CB-10 BRIEFING_SCHEMA + Kimi system prompt

```yaml
task: T-CB-10
  goal: "在 packages/llm 实现 BRIEFING_SCHEMA（7 段 LLM 产出 · 不含数值字段）、system prompt、buildBriefingInput 三个导出，并与 withScrubber 集成"
  constraints:
    - "schema 必须 JSON-schema-compliant 且 Kimi structured output 可解析"
    - "schema 严格按 design.md §6.1：cu.outlook 与 lc.outlook 仅含 trend (enum)，不含 support/resistance（数值由 T-CB-05 代码计算后注入 payload_json，不进 LLM）"
    - "schema 共 7 段：cu.logic_summary / cu.outlook.trend / lc.logic_summary / lc.outlook.trend / macro_summary / risk_notes[] / procurement_advice (enum 四选一)"
    - "system prompt 必须包含 design.md §6.2 全部 5 条硬约束（禁虚构数值 / 禁投资意见 / 禁价格数值字段 / logic_summary 不预测未来价位 / JSON schema 失败丢弃）"
    - "禁止把 v1.0 DAILY_REPORT_SCHEMA 改坏"
    - "withScrubber 集成沿用 v1.0 packaging（不改 scrubber 中间件本身）"
  ask_agent_first:
    - "restate v1.0 DAILY_REPORT_SCHEMA / withScrubber 调用模式"
    - "restate design.md §6.1 BRIEFING_SCHEMA（确认 outlook 仅含 trend）+ §6.2 prompt 5 条约束"
    - "outline buildBriefingInput 形参（quotes 当日 + 近 5 日序列 + 24h 铜锂相关 items 摘要）"
    - "list 测试（schema 7 段 validation pass/fail + 数值幻觉拒绝 + procurement_advice 越界 + scrubber 触发路径）"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/briefing-schema.ts"
    - "packages/llm/src/index.ts (追加 export)"
    - "packages/llm/src/__tests__/briefing-schema.test.ts"
  rollback: "revert PR；DAILY_REPORT_SCHEMA 不受影响"
  acceptance:
    - "schema validation 测试覆盖 7 段全部字段（合法 / 缺字段 / 数值幻觉如 outlook 出现 support 字段会被拒 / procurement_advice 越界）全绿"
    - "withScrubber 集成测试：mock Kimi 返回合法 7 段 JSON → 结构化解析成功"
    - "withScrubber PII 命中路径：mock 输入含手机号 → 跳过 LLM + 写 scrubber audit log"
    - "schema TypeScript 类型 `Briefing` 推导不含 outlook.support / outlook.resistance"
```

### T-CB-11 docx 渲染封装

```yaml
task: T-CB-11
  goal: "实现 apps/worker/src/lib/briefing-render.ts，封装 docxtemplater + 模板 lint + MinIO 上传"
  constraints:
    - "禁止把模板路径硬编码；从 process.env.BRIEFING_TEMPLATE_PATH 读"
    - "渲染前先 lint：模板中所有 {{key}} 必须能在 briefing_template_fields 表里找到"
    - "MinIO bucket 用 process.env.BRIEFING_MINIO_BUCKET"
    - "docx 文件名固定为 briefing-YYYYMMDD.docx（统一便于检索）"
    - "渲染失败必须 throw BriefingRenderError（packages/shared/errors.ts 新增）"
  ask_agent_first:
    - "restate v1.0 MinIO 客户端封装（如有）"
    - "outline docxtemplater 用法与异常处理"
    - "list 测试（模板缺字段 / 占位符失效 / MinIO 失败）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/lib/briefing-render.ts"
    - "apps/worker/src/lib/__tests__/briefing-render.test.ts"
    - "packages/shared/src/errors.ts (新增 BriefingRenderError 子类)"
    - "design/templates/briefing.docx (新增模板，按用户提供的版本)"
  rollback: "revert PR；MinIO 已上传文件可保留"
  acceptance:
    - "Vitest 全绿（模板 lint / 渲染成功 / MinIO 上传 mock）"
    - "新增 BriefingRenderError instanceof AppError === true"
    - "docx 渲染产物用 unzip 解开能看到填充后的占位值"
```

### T-CB-12 钉钉群机器人 SDK

```yaml
task: T-CB-12
  goal: "实现 apps/worker/src/lib/dingtalk-bot.ts，支持加签 + actionCard/text/markdown 消息"
  constraints:
    - "加签算法严格按 design.md §10.2"
    - "禁止把 webhook URL / sign secret 写入日志（Pino redact 配置）"
    - "HTTP timeout 10s，失败必须 throw DingtalkBotError（packages/shared 新增）"
    - "禁止任何外发请求绕过 v1.0 Pino logger"
  ask_agent_first:
    - "restate 钉钉自定义机器人加签算法"
    - "outline 函数签名"
    - "list 测试（加签 vector / 5xx 重试 / 错误码 errcode!=0）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/lib/dingtalk-bot.ts"
    - "apps/worker/src/lib/__tests__/dingtalk-bot.test.ts"
    - "packages/shared/src/errors.ts (追加 DingtalkBotError)"
    - "apps/worker/src/logger.ts (追加 redact 字段)"
  rollback: "revert PR"
  acceptance:
    - "加签输出与官方文档 reference vector 一致"
    - "Pino 日志中 webhook_url / sign_secret 字段为 [REDACTED]"
    - "5xx 测试：mock fetch → 3 retry → throw DingtalkBotError"
```

### T-CB-13 briefing-gen job

```yaml
task: T-CB-13
  goal: "实现 briefing-gen BullMQ job + scheduler cron（工作日 16:00），串起 precheck → context → LLM(7 段) → 代码注入 support/resistance → docx → 落库（design.md §5.2 5 步 + step 3.5）"
  constraints:
    - "调 LLM 必经 withScrubber"
    - "v0.4 fix E1：precheck 第一步必须先查 quotes-fetch BullMQ 队列状态（`queue.getJobCounts('waiting','active','delayed')`），若 waiting+active+delayed > 0 视为 15:30 quotes-fetch 尚未跑完（代理池故障 / 信源积压），延迟 5min 重试 ×2；仍非空则 abort（gen_status=failed + 红色告警 enqueue），不进入字段覆盖率检查；目的：避免 16:00 启动时把「数据未到位」误判为「字段覆盖率不足 → degraded」"
    - "precheck 字段覆盖率 < 5 → 延迟 5min 重试 ×2 → 仍不足则 gen_status=degraded（缺失字段标 fallback_text）"
    - "step 3 LLM 仅 7 段（T-CB-10 schema）"
    - "step 3.5 必须调 packages/core computeSupportResistance() 算出 cu/lc 的 support/resistance（整数），merge 入 payload_json.{cu,lc}.outlook 后再交给 docx 渲染；LLM 输出不得携带 support/resistance（schema 已禁，运行时若 LLM 漏出字段则丢弃）"
    - "节假日跳过（packages/core isBusinessDay）"
    - "成功后 enqueue briefing-push job"
    - "禁止使用 v1.0 daily-gen 同名变量名（避免 import 混淆）"
  ask_agent_first:
    - "restate v1.0 daily-gen.ts 整体流程"
    - "outline 5 步 + step 3.5 实现（design.md §5.2）"
    - "outline 近 20 交易日序列查询 SQL（commodity_quotes WHERE metric_key=? ORDER BY observed_at DESC LIMIT 20）"
    - "list 异常路径（LLM 失败 / s/r 样本不足 / docx 失败 / DB 失败）"
    - "list 测试（成功 / degraded / 节假日 / precheck 失败 / s/r 样本不足走 fallback / v0.4 fix E1 quotes-fetch 队列非空延迟）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/briefing-gen.ts"
    - "apps/worker/src/scheduler.ts (追加 cron)"
    - "apps/worker/src/queues.ts (追加 queue)"
    - "apps/worker/src/__tests__/briefing-gen.test.ts"
  rollback: "禁用 cron + revert PR；commodity_briefings 残留行可保留"
  acceptance:
    - "Vitest 端到端：mock adapter→quotes 入库→mock Kimi(7 段)→注入 s/r→docx 渲染→MinIO upload→DB INSERT，全绿"
    - "step 3.5 测试：mock 20 日序列 → payload_json.cu.outlook.{support,resistance} 为整数；序列 8 项 → 两值 null + docx fallback '—'"
    - "Degraded 路径：仅 3 字段入库 → gen_status='degraded' + payload_json 含 fallback"
    - "节假日跳过：briefing_holidays 含当日 → job return"
    - "重复触发同一日：UNIQUE (briefing_date) 冲突 → 返回已有 id 不重新生成"
    - "v0.4 fix E1 quotes-fetch 队列检查：mock queue.getJobCounts 返回 {waiting:2, active:1} → job 走 5min 延迟分支 ×2；mock 一直非空 → 最终 abort 写 gen_status='failed'，不进入覆盖率检查路径"
```

### T-CB-14 briefing-push job

```yaml
task: T-CB-14
  goal: "实现 briefing-push BullMQ job + scheduler cron（工作日 16:05），把简报推送到全部启用的 briefing_targets"
  constraints:
    - "并发=3（避免钉钉单 IP 限流）"
    - "失败指数退避 ×3"
    - "最终成功/失败状态写 briefing_pushes 表"
    - "钉钉 webhook 凭据不出现在日志"
    - "推送内容默认 actionCard + 站内深链（design.md §10.3）"
  ask_agent_first:
    - "restate dingtalk-bot.ts 接口"
    - "outline job 流程（拉 targets → 拉 briefing payload → 发送 → upsert push 记录）"
    - "list 异常路径（target 全禁 / 全失败 / 部分失败）"
    - "list 测试"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/briefing-push.ts"
    - "apps/worker/src/scheduler.ts (追加 cron)"
    - "apps/worker/src/queues.ts (追加 queue)"
    - "apps/worker/src/__tests__/briefing-push.test.ts"
  rollback: "禁用 cron + revert PR；briefing_pushes 残留行可保留"
  acceptance:
    - "Vitest 全绿（成功 / 部分失败 / 全失败 / 无 target）"
    - "失败 3 次后 push_status='failed' + 红色告警 enqueue（mock）"
    - "钉钉 webhook URL 不出现在 captured logs"
    - "重复推同一 (briefing_id, target_id) 跳过（UNIQUE 约束）"
```

### T-CB-15 cleanup job 扩展（v1.1 retention）

```yaml
task: T-CB-15
  goal: "v1.0 cleanup job 追加两条 DELETE：commodity_quotes 365 天 / commodity_briefings 90 天"
  constraints:
    - "事务内执行；FK 已由 briefing_pushes ON DELETE CASCADE 处理"
    - "不影响 v1.0 既有 DELETE 行为"
    - "MinIO docx 文件清理由 MinIO bucket lifecycle policy 处理（不在 cleanup job 里删 MinIO）"
    - "DELETE 计数写结构化日志"
  ask_agent_first:
    - "restate v1.0 cleanup.ts 现有 DELETE 列表"
    - "outline 新增 2 条 DELETE 与已有的顺序"
    - "list 测试（fixture 数据 → 跑 cleanup → SELECT 验证）"
  owner: "agent-infra"
  scope:
    - "apps/worker/src/jobs/cleanup.ts (追加)"
    - "apps/worker/src/jobs/__tests__/cleanup.test.ts (追加用例)"
    - "deploy/Dockerfile.backup 不变 / MinIO bucket lifecycle 文档化 in README"
  rollback: "revert PR；新表 retention 不会失效（数据可继续保留）"
  acceptance:
    - "测试库 fixture：365 天前 quotes / 90 天前 briefings → cleanup 后被删"
    - "FK 级联：删 briefings 时 briefing_pushes 行被 CASCADE 删除"
    - "v1.0 cleanup 测试全部仍通过"
    - "结构化日志包含 deleted_count for each table"
```

---

## 4. V11-P3 · 前端 / 后台 / 监控 / 验收（2026-07-05）

### T-CB-16 /api/briefing/* Route Handlers（含 FR-110 download + 410 Gone）

```yaml
task: T-CB-16
  goal: "实现 design.md §8 全部 10 个 API 端点（含 GET /api/briefing/:id/download）+ Zod 输入校验 + RBAC + 错误结构 + FR-110 410 Gone 语义"
  constraints:
    - "用 v1.0 已有的 RBAC 中间件，不重写"
    - "Zod schema 输入校验严格"
    - "错误响应严格遵循 v1.0 格式：{ error: { code, message, details? } }"
    - "GET /api/briefing/:id/download：briefing 不存在 → 404；存在但 briefing_date < now-90d 或 MinIO headObject 404 → 返 **410 Gone** + code='BRIEFING_DOCX_EXPIRED'（FR-110 / design.md §8）；命中则流式返 docx，Content-Type=application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    - "GET /api/briefing/targets 返回 sign_secret 必须 mask 为 '***'（design.md §13 风险 4）"
    - "POST regenerate / repush 用 BullMQ enqueue，不在 HTTP 请求里同步等待"
  ask_agent_first:
    - "restate v1.0 /api/sources Route Handlers 风格"
    - "restate v1.0 详情 API 404 防枚举 pattern"
    - "outline 10 个端点的 handler 文件结构（含 download）"
    - "outline download 端点流式响应实现（MinIO getObject → stream pipe）"
    - "list 测试用例（每个 endpoint × happy + auth fail + validation fail + download 410/404）"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/briefing/route.ts"
    - "apps/web/app/api/briefing/[id]/route.ts"
    - "apps/web/app/api/briefing/[id]/download/route.ts (新增 FR-110)"
    - "apps/web/app/api/briefing/[id]/regenerate/route.ts"
    - "apps/web/app/api/briefing/[id]/repush/route.ts"
    - "apps/web/app/api/briefing/targets/route.ts"
    - "apps/web/app/api/briefing/targets/[id]/route.ts"
    - "apps/web/app/api/briefing/targets/[id]/test/route.ts"
    - "apps/web/app/api/briefing/__tests__/**"
  rollback: "revert PR；前端尚未使用，无影响"
  acceptance:
    - "Vitest 全绿（≥ 20 用例，含 download happy / 410 expired / 404 not-found）"
    - "auth fail：viewer 调 POST regenerate → 403"
    - "validation fail：缺字段 → 400 + Zod error details"
    - "sign_secret mask：响应 JSON 含 '***'，不含真值"
    - "FR-110 验证：fixture briefing.briefing_date=91 天前 → GET download 返 410 + code='BRIEFING_DOCX_EXPIRED'（不是 404，不是 200）"
    - "FR-110 边界：briefing.briefing_date=90 天前（含当日）→ 200 流式返 docx"
```

### T-CB-17 /briefing 列表 + 详情页

```yaml
task: T-CB-17
  goal: "实现 /briefing 列表（倒序时间线）+ /briefing/[id] 详情页（含 payload_json 可视化 + 推送状态 + 7 日折线）"
  constraints:
    - "RSC 默认 + 客户端组件仅用于交互（图表 / 重新生成按钮）"
    - "折线图用 recharts（v1.0 已引入）"
    - "TanStack Query 走 v1.0 已有配置"
    - "导航增项只追加一行 <Link>，不改其他菜单"
    - "状态码：briefing 不存在 → 404（防枚举）；存在但 gen_status='failed' → 404 + 详情页友好文案；>90 天 docx 已 retention 清理 → 详情页可访问但'下载 docx'按钮触发的 download API 返 **410 Gone**（FR-110 / design.md §8）；UI 灰态显示'已过保留期'"
    - "v0.4 fix E3：CU/LC outlook 卡片渲染 support/resistance 时，若 payload_json.{cu,lc}.outlook.support==null 或 resistance==null（packages/core computeSupportResistance 因近 20 日样本 < 10 静默降级，常见于连续节假日 / 信源故障），卡片底部必须显示一行 muted 文案『近期数据样本不足，支撑/压力位计算已降级（design.md §6.5）』，避免用户把 '—' 误解为 LLM 输出空"
  ask_agent_first:
    - "restate v1.0 /daily 与 /timeline 实现"
    - "outline 列表 / 详情 / 折线组件拆分"
    - "list 测试（Playwright e2e）"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/briefing/page.tsx"
    - "apps/web/app/briefing/[id]/page.tsx"
    - "apps/web/components/briefing/**"
    - "apps/web/components/nav/* (仅追加链接)"
    - "apps/web/e2e/briefing.spec.ts"
  rollback: "revert PR；导航增项可单独 revert"
  acceptance:
    - "Playwright e2e 全绿（列表分页 / 详情 404 / 重新生成按钮 disabled 当 status=pending / 90 天外详情页显示'已过保留期'灰态 + 下载按钮触发 410）"
    - "v0.4 fix E3 测试：fixture briefing payload_json.cu.outlook={trend:'区间震荡', support:null, resistance:null} → 详情页可见『近期数据样本不足，支撑/压力位计算已降级』提示条；fixture support/resistance 为整数 → 提示条不出现"
    - "Lighthouse perf ≥ 80（与 v1.0 一致）"
    - "RSC：列表页 server-rendered（network 面板可见首屏 HTML 已含数据）"
    - "导航增项在 RBAC viewer 可见，admin 多见 /admin/briefing/targets 入口"
```

### T-CB-18 /admin/briefing/targets 后台

```yaml
task: T-CB-18
  goal: "实现 /admin/briefing/targets 列表 + 新增 / 编辑 / 删除 / 测试推送"
  constraints:
    - "admin only（middleware 守卫 + UI 防御性 RBAC 双层）"
    - "sign_secret 输入框 type='password'，编辑时显示掩码不显示真值"
    - "测试推送按钮调 POST /api/briefing/targets/:id/test，结果用 toast 展示"
    - "删除走软确认（需用户输入 target 名再确认），不能误删"
  ask_agent_first:
    - "restate v1.0 /admin/sources 风格"
    - "outline 表格 + 表单组件"
    - "list 测试（Playwright e2e admin/editor/viewer 三个角色）"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/briefing/targets/page.tsx"
    - "apps/web/components/briefing/target-form.tsx"
    - "apps/web/e2e/admin-briefing-targets.spec.ts"
  rollback: "revert PR"
  acceptance:
    - "Playwright e2e 全绿（CRUD × 角色矩阵 × 测试推送）"
    - "viewer 直接访问 URL → 重定向到 /auth/login"
    - "editor 访问 → 403 page"
    - "sign_secret 字段在 HTML 中不可读（type=password + 服务端 mask）"
```

### T-CB-19 Grafana 监控面板扩展

```yaml
task: T-CB-19
  goal: "deploy/grafana/dashboards 新增 v1.1 commodity-briefing 仪表盘 + provisioning 注册"
  constraints:
    - "不改 v1.0 dashboard JSON"
    - "新 dashboard 标 tag='v1.1'"
    - "5 个面板（design.md §15）：gen 成功率 / push 成功率 / 字段覆盖率 / quotes 时延 / Kimi 月度成本"
    - "告警规则放 alerts/commodity-briefing.yaml"
  ask_agent_first:
    - "restate v1.0 grafana provisioning 文件结构"
    - "outline 面板查询（PromQL / loki / direct postgres）"
    - "list 测试（Grafana provisioning lint）"
  owner: "agent-infra"
  scope:
    - "deploy/grafana/dashboards/commodity-briefing.json"
    - "deploy/grafana/provisioning/alerts/commodity-briefing.yaml"
    - "deploy/grafana/README.md (追加面板说明)"
  rollback: "revert PR；删除新 dashboard 文件"
  acceptance:
    - "Grafana provisioning lint pass"
    - "面板在 Grafana 加载无报错（手工验收）"
    - "4 条告警规则可触发（fixture 触发 mock）"
    - "v1.0 dashboard 完全未变动"
```

### T-CB-20 release smoke 扩展

```yaml
task: T-CB-20
  goal: "在 v1.0 release smoke spec 基础上追加 v1.1 端到端烟雾测试（不分裂为独立 release v1.1.0，与 v1.0.1 patch 一同测试）"
  constraints:
    - "不改 v1.0 已有的 release-smoke spec 用例"
    - "新用例 tag='@v11'"
    - "覆盖：节假日跳过 / 字段缺失降级 / 推送失败重试 / 模板 lint 失败"
    - "docs/release/v1.1.0-smoke.md 文档"
  ask_agent_first:
    - "restate v1.0 release-smoke.spec.ts 现有用例"
    - "outline 4 个新场景的测试数据准备"
    - "list 测试运行环境要求"
  owner: "agent-infra"
  scope:
    - "apps/web/e2e/release-smoke.spec.ts (追加 @v11 用例)"
    - "docs/release/v1.1.0-smoke.md"
    - "scripts/v11-smoke-prep.ts (测试数据准备脚本)"
  rollback: "revert PR"
  acceptance:
    - "v1.0 已有 release smoke 用例全部仍通过"
    - "新 @v11 用例 4 项全绿（在 build server 环境验收）"
    - "docs 文档对齐 v1.0 release 文档风格"
```

### T-CB-21 v1.1 文档与上线 runbook

```yaml
task: T-CB-21
  goal: "更新 CLAUDE.md PROJECT 段 + 写 v1.1 runbook + handoff.md 同步"
  constraints:
    - "CLAUDE.md 只追加 v1.1 模块说明，不重写已有 v1.0 内容"
    - "runbook 含：节假日表年度维护 / 钉钉 webhook 凭据轮换 / 模板 docx 改版流程 / 失败重推 SOP"
    - "handoff.md 同步 v1.1 进入 Release 阶段 + Owner=Human/Build Server"
  ask_agent_first:
    - "restate CLAUDE.md 现有结构"
    - "outline runbook 章节"
    - "list 评审项（人工 walk-through）"
  owner: "agent-infra"
  scope:
    - "CLAUDE.md (PROJECT 段追加 v1.1 章节)"
    - "docs/runbook/v1.1-commodity-briefing.md"
    - "handoff.md (同步状态)"
  rollback: "revert PR"
  acceptance:
    - "CLAUDE.md grep 'v1.1' 命中新增段"
    - "runbook 4 个 SOP 完整可执行"
    - "handoff.md Current Control 行更新到 v1.1 Release"
```

---

## 5. 风险登记

| # | 风险 | 严重度 | 缓解 task |
|---|---|---|---|
| R1 | 交易所页面改版导致 adapter 全部失效 | High | T-CB-07/08 fixture 测试 + T-CB-19 红色告警 + admin 可单 source 禁用 |
| R2 | RSSHub 公共 route 失效 | Medium | T-CB-04 自部署 + Redis 缓存 + 关键 route 镜像版本 pin |
| R3 | LLM 输出数值幻觉 | High | T-CB-10 schema 强制 + system prompt 硬约束 + 验收人工抽检 100% |
| R4 | 钉钉 webhook 凭据泄漏 | High | T-CB-12 Pino redact + T-CB-16 API mask + T-CB-18 UI type=password 三层 |
| R5 | 16:00 推送时夜盘价缺 | Medium | Q-11I v0.3 决策接受 16:00 日盘版；T-CB-11 模板字段加注"日盘收盘价 · 夜盘见次日简报"；夜盘版 v1.2 评估 |
| R6 | 节假日表漏录 → 空简报 | Medium | T-CB-13 precheck 覆盖率不足 → abort 不发空简报 |
| R7 | sources.fetcher_type CHECK 扩展 rollback 风险 | Low | T-CB-02 双向 migration + rollback 路径已定义 |
| R8 | Kimi 月度成本超 100 元 | Low | T-CB-19 成本面板 + v1.0 NFR-05 总预算管控 |
| R9 | docx 模板被误改导致渲染失败 | Medium | T-CB-11 启动 lint + 模板纳入 git + 不允许运行时上传 |
| R10 | 与 v1.0 测试套件冲突 | Low | 全部 task acceptance 含"v1.0 测试不挂"门槛 |

---

## 6. 项目硬约束自检（沿用 v1.0 CLAUDE.md PROJECT 段）

| v1.0 硬约束 | v1.1 是否触犯 | 落地位置 |
|---|---|---|
| D2_chain 必须代码计算 | 不涉及（v1.1 不动 scoring） | — |
| alert_type 统一在 computeAlert() | 不涉及（v1.1 不发 alert） | — |
| 配置必须存数据库 | ✅ 信源 / 节假日 / 模板字段 / 推送目标全入库 | T-CB-03 / T-CB-18 |
| 不存原始 HTML 快照 | ✅ commodity_quotes.raw_text 写入前必经 strip HTML + 截断 ≤2000 字符（design.md §4.3 / requirements §9.2） | T-CB-01 / T-CB-07 / T-CB-08 |
| 不拉用户手机号 | 不涉及 | — |
| 公网 LLM 调用前必经 scrubber | ✅ briefing-gen withScrubber 集成 | T-CB-10 / T-CB-13 |
| 代理池不绕 robots.txt | ✅ quotes adapter 走 v1.0 http.ts | T-CB-07/08 |
| 数据保留 90 天（配置永久） | ✅ quotes 365 天 / briefings 90 天 / 配置类永久 | T-CB-15 |
| bcrypt(12) + JWT httpOnly + 2h + 滑动续期 | 不涉及 | — |
| TZ=Asia/Shanghai + dayjs().tz() | ✅ packages/core/briefing.ts 用 packages/shared/dayjs | T-CB-05 |
| scoring_config seed ON CONFLICT DO NOTHING | ✅ v1.1 全部 seed 同等约束 | T-CB-03 |
| 限速器 quota.ts Lua | 不涉及（v1.1 不进 v1.0 主 pipeline） | — |
| cluster Redis 锁 | 不涉及 | — |
| commit message [DMA-XX] 动词 + 范围 | ✅ v1.1 commit 应为 `[T-CB-XX] 动词 + 范围` | 全部 task |
| /init 不重写 CLAUDE.md 而是 append | ✅ T-CB-21 append v1.1 段 | T-CB-21 |

---

## 7. 后续动作

1. ✅ 用户评审 v0.1（含 requirements.md Q-11G..L 决策） → v0.2 → v0.3（5 项 Human-decision 2026-05-19）
2. ✅ 建 Linear DMA issue（[DMA-151..178](https://linear.app/dmarkubex/issue/DMA-151) · 28 条 · 全部 Backlog · 39 条 blockedBy）
3. ✅ 提交 Antigravity Plan Review（[DMA-153](https://linear.app/dmarkubex/issue/DMA-153) · requirements + design + tasks 一次性，对齐 v1.0 DMA-24 节奏）→ APPROVED-with-conditions（3 Minor + 4 Edge）
4. ✅ Fix Plan v0.4（M1/M2/M3/E1/E2/E3/E4 全闭合 · design.md + tasks.md 同步至 v0.4 · 详见两文件 changelog · 报告归档 `.ai/linear/v11-plan-review-report.md`）
5. v1.0.0 GA 完成 → [DMA-154 V11-P1](https://linear.app/dmarkubex/issue/DMA-154) 升 Todo → Codex Execute V11-P1
6. P1 / P2 / P3 串行执行（不并行，避免新模块多线程引入未知冲突）
