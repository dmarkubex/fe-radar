# Gate 0 第六批 — 信源通道能力开发 Tasks

背景：第五批（0062）暴露 4 个能力缺口，需代码开发后才能继续扩充国际/对手信源。证据见 `spec/source-gate0/evidence-2026-08-15.md`。

## T-G5-01 — rss fetcher 支持 keywordFilter

- **goal**：rss 源可按关键词收窄，解锁 Canary Media（728）等宽频道的复检启用。
- **constraints**：语义镜像 `html.ts`（title+content 包含任一关键词即保留；过滤后为空抛 `FETCH_RSS_EMPTY` SourceFetchError）；不改 html/playwright 行为；无新依赖。
- **ask_agent_first**：无。
- **owner**：agent-worker。
- **scope**：`apps/worker/src/fetchers/rss.ts`、`apps/worker/src/fetchers/__tests__/rss.test.ts`。
- **rollback**：回退两文件；生产已 seed 的 rss 源无 keywordFilter 配置，行为不变。
- **acceptance**：新增单测覆盖"有关键词命中保留/全部过滤为空抛错/无 keywordFilter 不过滤"三条路径；`pnpm --filter @fe-radar/worker test` 与 `tsc --noEmit` 全绿。

## T-G5-02 — prefilter 预筛补韩文行业词

- **goal**：消除 LS Cable（718）等韩文源的预筛漏判（当前约 4/18 条韩文电缆新闻被误判不相关而丢弃）。
- **constraints**：只改 prompt 文案，不改判断逻辑/Schema；中英判断能力不回归。
- **ask_agent_first**：无。
- **owner**：agent-llm。
- **scope**：`packages/llm/src/prompts/prefilter.ts`；若有 prompt 快照测试同步更新。
- **rollback**：回退 prompt 单行。
- **acceptance**：prompt 含 케이블/해저케이블/전력/송전/배전/에너지저장/데이터센터 等行业词；`pnpm --filter @fe-radar/llm test` 与 tsc 全绿。

## T-G5-03 — parsePublishedAt 支持相对日期

- **goal**：解析"N分钟前/N小时前/N天前"与英文"N hours ago"，解锁国际能源网（25，列表仅相对时间）。
- **constraints**：单点修改 `apps/worker/src/fetchers/html.ts:parsePublishedAt`（chnenergy/powerchina/sgcc/official-news 四处 import 复用，无镜像副本）；相对时间按 `Date.now()` 回推，不引入时区硬编码；非法输入仍返回 null；绝对日期路径不回归。
- **ask_agent_first**：无。
- **owner**：agent-worker。
- **scope**：`apps/worker/src/fetchers/html.ts`、`apps/worker/src/fetchers/__tests__/html.test.ts`。
- **rollback**：回退两文件。
- **acceptance**：单测覆盖"3天前/12小时前/45分钟前/2 days ago/1 hour ago/非法输入 null"；既有日期解析测试全绿；worker 全量 vitest + tsc 通过。

## T-G5-04 — BYD 官方新闻 announcement adapter

- **goal**：接入 BYD 英文官网新闻（Vue 动态渲染，数据接口 `https://cms-prod.byd.com/es/search`）。
- **constraints**：adapter 注册进 `announcements/index.ts`；只允许官方 JSON 接口；日期须来自接口字段，禁止抓取时间兜底；seed 默认 disabled。
- **ask_agent_first**：接口需要鉴权/签名或返回结构不稳定时暂停上报。
- **owner**：agent-worker。
- **scope**：`apps/worker/src/fetchers/announcements/byd-news.ts`（新建）、`announcements/index.ts` 注册、单测、migration 0063 seed。
- **rollback**：注销 adapter + 软禁 seed 行。
- **acceptance**：生产 worker 网络实测 ≥3 条带真实日期；单测覆盖解析与异常；gate0 domains=competitors/products。

## T-G5-05 — Cloudflare 站点 playwright 通道验证

- **goal**：判定 energy-storage.news / Fluence / DCD 能否经现有 playwright fetcher（chromium-headless-shell，声明式选择器）绕过 CF 挑战。
- **constraints**：只读探测；playwright 源 config 必须为声明式选择器（0056 后禁止 extractor JS 字符串）；不过 CF 不强行启用。
- **ask_agent_first**：CF 挑战过不去时直接记录结论，不引入新绕过手段。
- **owner**：agent-worker。
- **scope**：生产探测证据（evidence 文档追加）；若通过则 migration 0063 附带 playwright seed（默认 disabled）。
- **rollback**：无（只读）/ seed 软禁。
- **acceptance**：每站给出 PASS/FAIL + 证据；PASS 站点 selector 落 migration。

## T-G5-06 — migration 0063 汇总落库

- **goal**：BYD seed、（如过）CF 站点 playwright seed、南网储能招采行（698 的 q=储能 变体，复用 html fetcher + 同 selector）。
- **constraints**：全部 `enabled=false` + `ON CONFLICT (url) DO NOTHING`；带 gate0.domains；不改 0062 及之前文件。
- **owner**：agent-db。
- **scope**：`packages/db/migrations/0063_source_gate0_batch6_channels.sql`。
- **rollback**：软禁本批 URL。
- **acceptance**：migrate 幂等；新行默认禁用。

## T-G5-07 — 构建部署与启用复测

- **goal**：worker 镜像构建推 Harbor → stack 更新 → 逐源 verify-sources → 启用 + prefilter 相关率复测。
- **constraints**：镜像 tag 按当次 commit 短 hash；部署后 migrate exit 0；启用前相关率 ≥80% 或人工复核记录在案。
- **owner**：agent-infra。
- **scope**：`deploy/scripts/build-images.sh worker --push`、Portainer stack 89。
- **rollback**：stack worker 回滚到上一 RepoDigest；新源 enabled=false。
- **acceptance**：新通道源逐源生产烟测 PASS；启用结果与相关率落入 evidence 文档。
