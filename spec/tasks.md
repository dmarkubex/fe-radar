# FE-Radar — Tasks (v0.3 DRAFT)

> **v0.3 changelog (Antigravity 第二轮 Stage 4 Audit fix · 2 Systemic + 1 Edge)**：
>
> - **R1**：T-M0-02 constraint 删 `mobile_hash`；T-M4-05a goal / constraint / scope 删 mobileHash 参数与字段；改决策树为"name+dept 唯一匹配自动合并 / 多匹配 manual"
> - **R2**：T-M0-02 constraint 加 `disabled_at`；T-M5-03 constraint 加 disabled_at 软删（替代旧"删除"语义）
> - **E1**：T-M3-05 constraint 加 block / pending / dropped 排除（与 T-M3-01 timeline API 一致）

> **状态**：✅ **APPROVED**（Antigravity DMA-24 复审）· ready for Codex Execute (M0)
> **基础**：`spec/requirements.md` v0.7 + `spec/design.md` v0.7 + `.ai/shared/style-invariants.md` v1.0
> **作者**：Claude Code（Plan Stage 产出）
> **格式**：每条 task 严格遵循 `.ai/shared/task-template.md`（goal / constraints / ask_agent_first / owner / scope / rollback / acceptance）
>
> **DMA-24 复审 4 Minor 处理**：
>
> - B1（users schema 同步 v0.7）→ 已直接补到 design.md §8（users 加 mobile_hash/merged_at/merged_from_user_id + merge_conflicts 表）；T-M0-02 验收照此实施
> - B2（block item timeline 展示规则）→ T-M3-01/02/03 加默认排除 constraint（见下）
> - B3（代理池 health check 可调）→ T-M1-10 改 health check 周期为可配置（见下）
> - B4（项目代号词典 admin CRUD）→ MVP 文件加载（env `SCRUBBER_PROJECT_DICT_FILE`），admin CRUD 推迟到 M5+（不阻塞）
>
> **v0.2 changelog (DMA-23 Antigravity Stage 4 Fix)**：
>
> - **R1 (Critical · 外部 LLM 泄密)** → 新增 T-M2-14 (`scrubber` 模块) + T-M2-15 (LLM 链集成)；修 T-M2-06/08 + T-M4-03 加 "调 LLM 前必经 scrubber" constraint
> - **R2 (Critical · 账号合并)** → 新增 T-M4-05a (合并策略 + 冲突 resolve)；修 T-M4-05 scope 加 merge hook
> - **R3 (Critical · 爬虫抗封锁)** → 新增 T-M1-10 (代理池 + UA 轮换)；修 T-M1-02/03/04 加切代理 fallback constraint
> - **E1 (Edge · HNSW vs ivfflat)** → 修 T-M2-09 加 M2 实施前 benchmark constraint
> - **E2 (Edge · cluster 竞态)** → 修 T-M2-10 加 Redis 分布式锁 constraint（worker 层装配，core 层不变）
> - **E3 (Edge · priority 饥饿)** → 修 T-M2-12 加陈旧度监控 + T-M5-01 Dashboard 加 priority backlog 行
> - 总 task 数 56 → **60**（+4 新增）

---

## 0. Sub-Agent 分工

| Agent           | 职责                                                     | 主要 scope                                                                                |
| --------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `agent-infra`   | monorepo 脚手架 / Docker Swarm / CI / 监控 / 部署        | `package.json` / `pnpm-workspace.yaml` / `deploy/*` / `.github/workflows/*` / `scripts/*` |
| `agent-db`      | Drizzle schema / migration / seed / 索引                 | `packages/db/**`                                                                          |
| `agent-llm`     | 三家 LLM SDK 封装 / prompt 模板                          | `packages/llm/**`                                                                         |
| `agent-core`    | 业务规则纯函数（评分 / 配额 / 聚类 / 告警 / 优先级判定） | `packages/core/**` · `packages/shared/**`                                                 |
| `agent-worker`  | BullMQ jobs（fetcher / pipeline / scheduler / cleanup）  | `apps/worker/**`                                                                          |
| `agent-web-api` | Next.js Route Handlers + 中间件 + Zod schema             | `apps/web/app/api/**` · `apps/web/lib/api/**` · `apps/web/middleware.ts`                  |
| `agent-web-ui`  | Next.js 页面 / 组件 / hooks / 状态                       | `apps/web/app/**`（除 `api/`）· `apps/web/components/**` · `apps/web/hooks/**`            |
| `agent-auth`    | 本地账号 + 钉钉 OAuth + RBAC 中间件                      | `apps/web/app/api/auth/**` · `apps/web/lib/auth/**` · users 表（与 agent-db 协作）        |

**并行安全保证**：

- 每个 task 的 scope 必须 ≤ 1 个 agent；多 agent 协作的功能拆为 a/b/... 子 task
- 跨 agent 接口先由 `agent-core` / `packages/shared` 定义类型，再各自实现
- 同一 milestone 内**同一文件**的修改不允许两个 task 并发；CI 用 `git diff --name-only` 检查 PR 间 file 重叠

---

## 1. Milestone 概览

| M        | 主题               | 目标日期   | task 数              | 关键 sub-agent                         |
| -------- | ------------------ | ---------- | -------------------- | -------------------------------------- |
| M0       | 脚手架与基线       | 2026-05-17 | 10                   | infra / db / web-ui / auth             |
| M1       | 抓取层             | 2026-05-31 | 10（+1 R3 代理池）   | worker / db / web-api / web-ui / infra |
| M2       | Pipeline 与评分    | 2026-06-14 | 15（+2 R1 scrubber） | llm / worker / core                    |
| M3       | 前端核心页面       | 2026-06-22 | 8                    | web-ui / web-api                       |
| M4       | 告警 · 日报 · 钉钉 | 2026-06-27 | 9（+1 R2 合并）      | worker / web-ui / web-api / auth       |
| M5       | 后台 · 监控 · 上线 | 2026-06-30 | 8                    | web-api / web-ui / worker / infra      |
| **合计** |                    |            | **60**               |                                        |

---

## 2. M0 · 脚手架与基线（2026-05-17）

### T-M0-01 monorepo 脚手架

```yaml
task: T-M0-01
  goal: "搭起 pnpm workspaces monorepo（apps/web + apps/worker + packages/{db,llm,core,shared}），确保各 package 互通且类型可解析"
  constraints:
    - "用 pnpm 不用 npm/yarn"
    - "tsconfig 走 root + 每个 package 继承 + path mapping"
    - "禁止把业务代码放 root，只放配置 / scripts"
  ask_agent_first:
    - "restate understanding of current code structure"
    - "outline execution steps"
    - "list risk points (TS path resolution / pnpm hoisting)"
    - "list tests to add or update"
  owner: "agent-infra"
  scope:
    - "package.json / pnpm-workspace.yaml / pnpm-lock.yaml"
    - "tsconfig.base.json / 各 package 的 tsconfig.json"
    - "apps/web/package.json (空骨架)"
    - "apps/worker/package.json (空骨架)"
    - "packages/{db,llm,core,shared}/package.json + index.ts (空骨架)"
  rollback: "revert PR；workspace 未发布无 deps 影响"
  acceptance:
    - "pnpm install 一键过"
    - "pnpm typecheck 全 package 绿"
    - "在 apps/web 里 import packages/shared 可解析"
    - "madge --circular packages/ apps/ 无循环"
```

### T-M0-02 Drizzle schema 初版

```yaml
task: T-M0-02
  goal: "实现 design.md §8 全部 schema 的 Drizzle 定义 + 初始 migration，所有约束与索引齐全"
  constraints:
    - "禁止字符串拼 SQL"
    - "全部 timestamp 用 TIMESTAMPTZ"
    - "feedbacks.item_id 必须 ON DELETE CASCADE"
    - "clusters.lead_item_id 必须 ON DELETE SET NULL"
    - "users CHECK 必须为 (username AND password_hash) OR dingtalk_id"
    - "users 必须含 v0.7/v0.8 字段：merged_at / merged_from_user_id / disabled_at（v0.8 R2）"
    - "users **不要** mobile_hash 字段（v0.8 R1 已撤；钉钉不返回手机号）"
    - "users 索引：`users_active_idx ON users (id) WHERE disabled_at IS NULL`"
    - "必须含 merge_conflicts 表（v0.7 R2 / DMA-24 B1）"
    - "item_analysis.quota_state CHECK 含 admitted/pending_over_quota/dropped_quota_expired/dropped_filter"
  ask_agent_first:
    - "restate design.md §8 schema 与 v0.6 fix 项"
    - "outline migration 文件结构与命名"
    - "list 索引（FTS zhparser、ivfflat、quality WHERE is_curated 等）"
    - "list 测试方法（pgTAP 或 Drizzle migration test）"
  owner: "agent-db"
  scope:
    - "packages/db/src/schema/*.ts"
    - "packages/db/migrations/0001_init.sql"
    - "packages/db/src/index.ts"
  rollback: "drizzle-kit migrate down 0001 OR drop schema public cascade + 重跑"
  acceptance:
    - "drizzle-kit generate 产物与 schema.ts 一致"
    - "migration 在空库跑成功"
    - "所有 CHECK / FK / UNIQUE / INDEX 用 \\d+ 在 psql 里能看到"
    - "pgvector 扩展已在 migration 里 CREATE EXTENSION IF NOT EXISTS"
```

### T-M0-03 scoring_config 默认 seed

```yaml
task: T-M0-03
  goal: "把 design.md §8 INSERT seed 块（weights/thresholds/t_coef/c_coef）作为版本化 migration 落地"
  constraints:
    - "ON CONFLICT (key) DO NOTHING（idempotent）"
    - "默认值与 requirements.md §7.2 / §7.3 完全一致"
    - "不能放 seed.local.sql"
  ask_agent_first:
    - "restate Q-D / Q-E 接受的默认值"
    - "outline migration 命名（避免与 0001 冲突）"
    - "list 测试方法（启动后 SELECT 验证）"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0002_scoring_config_seed.sql"
  rollback: "DELETE FROM scoring_config WHERE updated_by IS NULL（仅删未被 admin 改过的）"
  acceptance:
    - "migration 跑后 scoring_config 表有 4 行（weights/thresholds/t_coef/c_coef）"
    - "重跑 migration 不重复插入"
    - "JSON 值与 spec 一致（用 jq 校验）"
```

### T-M0-04 packages/shared 基础设施

```yaml
task: T-M0-04
  goal: "实现共享类型 + 错误类层级（AppError 子类）+ dayjs 时区配置 + 常量"
  constraints:
    - "AppError 必须是基类；SourceFetchError / LlmError / QuotaExceededError 必须继承"
    - "dayjs 强制注入 utc + timezone plugin，default tz = Asia/Shanghai"
    - "禁止在此包加业务逻辑"
  ask_agent_first:
    - "restate style-invariants §6/§9"
    - "outline 错误码命名（FETCH_TIMEOUT / LLM_JSON_INVALID / QUOTA_NORMAL_EXCEEDED 等）"
    - "list 测试覆盖率目标（≥ 90%）"
  owner: "agent-core"
  scope:
    - "packages/shared/src/errors.ts"
    - "packages/shared/src/types.ts"
    - "packages/shared/src/dayjs.ts"
    - "packages/shared/src/constants.ts"
    - "packages/shared/src/index.ts"
    - "packages/shared/src/__tests__/*"
  rollback: "revert PR；不影响其他 package（尚未导入）"
  acceptance:
    - "Vitest 覆盖率 ≥ 90%"
    - "所有 AppError 子类 instanceof AppError 为 true"
    - "dayjs().tz() 不传参数返回 Asia/Shanghai 时间"
```

### T-M0-05 packages/core skeleton

```yaml
task: T-M0-05
  goal: "为 priority / quota / scoring / alert 四个核心模块创建函数 stub + 类型签名 + 占位测试，让下游 agent 可并行实现"
  constraints:
    - "不依赖 packages/db（业务规则纯函数）"
    - "类型签名必须与 design.md 中代码片段对齐"
    - "stub 抛 NotImplementedError"
  ask_agent_first:
    - "restate design.md §5/§6/§7/§11 的接口"
    - "outline 类型导出与 ts-doc"
    - "list 测试桩"
  owner: "agent-core"
  scope:
    - "packages/core/src/{priority,quota,scoring,alert,cluster}.ts"
    - "packages/core/src/index.ts"
    - "packages/core/src/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "所有函数签名导出"
    - "占位测试用 expect.toThrow(NotImplementedError) 验证 stub 存在"
    - "其他 agent 可 import 类型不报错"
```

### T-M0-06 Next.js 15 + shadcn/ui 初始化

```yaml
task: T-M0-06
  goal: "在 apps/web 初始化 Next.js 15 App Router + Tailwind + shadcn/ui，提供占位首页"
  constraints:
    - "React 19 + TS strict"
    - "App Router（不用 Pages Router）"
    - "shadcn/ui 不批量复制，仅添加首页用到的（Button / Card）"
    - "中文 UI，无 i18n 框架"
  ask_agent_first:
    - "restate style-invariants §12"
    - "outline 路由结构（(timeline) (daily) (admin) auth/）"
    - "list 测试方法（Playwright smoke）"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/layout.tsx"
    - "apps/web/app/page.tsx"
    - "apps/web/app/globals.css"
    - "apps/web/tailwind.config.ts（历史任务记录；已随 Tailwind 4 迁移删除，配置迁至 apps/web/app/globals.css）"
    - "apps/web/components.json (shadcn 配置)"
    - "apps/web/components/ui/*（仅初始组件）"
    - "apps/web/next.config.js"
  rollback: "revert PR；占位页无业务影响"
  acceptance:
    - "pnpm dev 启动后 http://localhost:3000 显示占位首页"
    - "pnpm build + start 生产模式可启"
    - "Playwright smoke：标题包含 'FE-Radar'"
```

### T-M0-07 packages/db client + connection

```yaml
task: T-M0-07
  goal: "提供 Drizzle DB client + 连接池 + 健康检查函数，给 web/worker 共用"
  constraints:
    - "必须用 postgres-js 或 node-postgres + drizzle-orm"
    - "连接字符串从 env DATABASE_URL 读"
    - "pgvector 扩展自动 init"
  ask_agent_first:
    - "restate style-invariants §4"
    - "outline 连接池 size 默认值（web 10 / worker 5）"
    - "list 错误处理（连接失败重试 3 次）"
  owner: "agent-db"
  scope:
    - "packages/db/src/client.ts"
    - "packages/db/src/health.ts"
    - "packages/db/src/__tests__/*（用 testcontainers）"
  rollback: "revert PR"
  acceptance:
    - "agent-web 可 import { db } from '@fe-radar/db' 拿到实例"
    - "health() 返回 { ok, latencyMs }"
    - "testcontainers 集成测试通过"
```

### T-M0-08 Auth.js + 本地账号登录骨架

```yaml
task: T-M0-08
  goal: "在 apps/web 集成 NextAuth.js v5（Credentials provider）+ bcrypt(12) 密码校验 + JWT cookie"
  constraints:
    - "JWT httpOnly + SameSite=Lax + 2h 过期 + 滑动续期"
    - "钉钉 provider 留空（M4 再加）"
    - "RBAC middleware 拦截 /api/admin/* + admin 路由"
    - "禁止把密码 hash 写日志"
  ask_agent_first:
    - "restate requirements §10 + design §10a + style-invariants §8"
    - "outline NextAuth 配置 + middleware 顺序"
    - "list 测试用例（错密码 / 正确密码 / 过期 token）"
  owner: "agent-auth"
  scope:
    - "apps/web/auth.ts"
    - "apps/web/middleware.ts"
    - "apps/web/app/auth/login/page.tsx"
    - "apps/web/app/api/auth/[...nextauth]/route.ts"
    - "apps/web/lib/auth/*"
  rollback: "revert PR；DB 未引入字段变更"
  acceptance:
    - "用户用 username + 正确密码登录成功，cookie 写入"
    - "错误密码返回 401 不泄漏密码 hash"
    - "未登录访问 /api/admin/* 返回 401"
    - "admin 角色访问通过；viewer 访问 /api/admin/* 返回 403"
```

### T-M0-09 Docker Swarm stack.yml

```yaml
task: T-M0-09
  goal: "落地 design.md §12 stack.yml（web×2 / worker×3 / scheduler / postgres / redis / minio）+ TZ=Asia/Shanghai 全 service"
  constraints:
    - "不暴露公网，仅 internal overlay 网络"
    - "secrets 用 docker secret 不在 yaml 写"
    - "postgres 用 pgvector/pgvector:pg16，但需自定义 Dockerfile 装 zhparser"
  ask_agent_first:
    - "restate design.md §12 + §16 风险（zhparser）"
    - "outline secret 文件清单（DINGTALK_APP_SECRET / DEEPSEEK_API_KEY / KIMI_API_KEY / DB_PASSWORD）"
    - "list 验收方法（在测试环境部署）"
  owner: "agent-infra"
  scope:
    - "deploy/stack.yml"
    - "deploy/Dockerfile.postgres-zhparser"
    - "deploy/env.example"
    - "deploy/README.md"
  rollback: "docker stack rm fe-radar"
  acceptance:
    - "Portainer deploy 后 6 service 全 running"
    - "zhparser 在 PG 里 SELECT to_tsvector('zhparser', '电力电缆') 不报错"
    - "TZ=Asia/Shanghai 在所有容器 date 命令验证"
```

### T-M0-10 CI + lint/typecheck/test gate

```yaml
task: T-M0-10
  goal: "GitHub Actions：每 PR 跑 pnpm lint / typecheck / test / build；main 分支额外跑集成测试"
  constraints:
    - "用 pnpm cache + node 20"
    - "pre-commit hook 跑 lint-staged"
    - "禁止 --no-verify"
  ask_agent_first:
    - "restate style-invariants §15"
    - "outline workflow 文件结构"
    - "list 性能预算（PR 全套 < 10min）"
  owner: "agent-infra"
  scope:
    - ".github/workflows/ci.yml"
    - ".github/workflows/integration.yml"
    - ".husky/pre-commit"
    - "package.json scripts"
  rollback: "revert PR；CI 失败也不阻塞 main 已合代码"
  acceptance:
    - "PR 提交触发 CI"
    - "lint 失败让 PR red"
    - "typecheck 失败让 PR red"
    - "vitest 失败让 PR red"
```

---

## 3. M1 · 抓取层（2026-05-31）

### T-M1-01 sources schema 扩展 + Drizzle ORM

```yaml
task: T-M1-01
  goal: "完善 sources 表 schema + 写出 Drizzle ORM 查询函数（按 tier / category / enabled 过滤）"
  constraints:
    - "schema 已在 T-M0-02 创建；本 task 加补充字段（last_ok_at / fail_count）的索引"
    - "ORM 函数纯参数化，禁字符串拼"
  ask_agent_first:
    - "restate design.md §8 sources schema + §4 fetcher 配置 JSON 格式"
    - "outline ORM 函数签名"
    - "list 测试用例"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0003_sources_idx.sql"
    - "packages/db/src/repos/sources.ts"
    - "packages/db/src/__tests__/sources.test.ts"
  rollback: "drizzle-kit migrate down 0003"
  acceptance:
    - "listEnabledByTier(tier) 返回正确 sources"
    - "测试覆盖 ≥ 90%"
    - "EXPLAIN ANALYZE 显示用到 last_ok_at 索引"
```

### T-M1-02 RSS fetcher

```yaml
task: T-M1-02
  goal: "实现 SourceConfig.type='rss' 的 fetch 函数，输入 url，输出标准化 Item[] (url/title/content/published_at)"
  constraints:
    - "rss-parser ≤ 4 timeout 秒"
    - "UA 经 T-M1-10 代理池模块取（FE-Radar Bot 默认 + 政府站轮换池）"
    - "同站 ≥ 1s 间隔（用 Bottleneck 或 p-limit）"
    - "失败抛 SourceFetchError；429/403 时切代理池下一节点（R3 fix）"
    - "由 worker retry（指数退避 3 次）"
  ask_agent_first:
    - "restate design.md §4.1 + style-invariants §16"
    - "outline 字段映射（rss-parser 字段 → Item）"
    - "list 测试用例（valid rss / 空 rss / 超时 / 非法 XML）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/rss.ts"
    - "apps/worker/src/fetchers/__tests__/rss.test.ts"
    - "apps/worker/src/fetchers/index.ts"
  rollback: "revert PR"
  acceptance:
    - "对北极星电力 RSS（DMA-14 候选 T2-01）抓回 ≥ 10 条"
    - "字段映射正确（无 undefined）"
    - "断网测试抛 SourceFetchError 不挂进程"
```

### T-M1-03 HTML fetcher (cheerio)

```yaml
task: T-M1-03
  goal: "实现 SourceConfig.type='html' 的 fetch 函数（cheerio + 自定义 selectors）"
  constraints:
    - "selectors 配置在 sources.config JSON 字段"
    - "fetch 用 undici fetch + 5s timeout，代理 / UA 经 T-M1-10 代理池取"
    - "429/403/连续超时时切代理重试（R3 fix）"
    - "解析后丢弃 raw HTML（不存）"
  ask_agent_first:
    - "restate design.md §4.1 + style-invariants §16"
    - "outline selectors schema（item / title / link / date）"
    - "list 测试用例"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/html.ts"
    - "apps/worker/src/fetchers/__tests__/html.test.ts"
  rollback: "revert PR"
  acceptance:
    - "对国家能源局列表页（DMA-14 T1-01）抓回 ≥ 5 条"
    - "原始 HTML 解析后内存释放（不写盘）"
```

### T-M1-04 Playwright fetcher

```yaml
task: T-M1-04
  goal: "实现 SourceConfig.type='playwright' 的 fetch 函数（headless Chromium + waitFor + extractor 函数）"
  constraints:
    - "playwright timeout 30s"
    - "复用 BrowserContext，禁止每条新建 browser"
    - "BrowserContext 启动参数从 T-M1-10 代理池取 proxy + userAgent（R3 fix）"
    - "extractor 是序列化字符串，eval 时必须 sandbox"
  ask_agent_first:
    - "restate design.md §4.1"
    - "outline browser 池实现（最大 2 个 context）"
    - "list 安全风险（eval 用户配置代码）+ 缓解（vm2 或仅允许白名单）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/fetchers/playwright.ts"
    - "apps/worker/src/fetchers/__tests__/playwright.test.ts"
  rollback: "revert PR；用户可在 sources 后台禁用 type=playwright 的源"
  acceptance:
    - "对雪球行业讨论（DMA-14 T3-07）抓回 ≥ 3 条"
    - "10 条连续抓取内存稳定（无泄漏）"
    - "extractor 仅能访问允许的全局对象"
```

### T-M1-05 调度器（cron + retry + 7d disable）

```yaml
task: T-M1-05
  goal: "BullMQ scheduler：每 6h cron 入队所有 enabled sources；fetcher job 失败重试 3 次；连续失败 7 天自动 disable + 告警"
  constraints:
    - "cron 表达式 0 */6 * * * 按 Asia/Shanghai"
    - "fail_count 字段在 sources 表更新"
    - "并发 5（每轮）"
    - "禁用必须 emit 到日志 + 后续 admin Dashboard 显示"
  ask_agent_first:
    - "restate design.md §4.2 + style-invariants §10"
    - "outline retry strategy（200ms/800ms/3.2s 指数退避）"
    - "list 边界（worker 重启时 cron 不重复）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/scheduler.ts"
    - "apps/worker/src/queues.ts"
    - "apps/worker/src/__tests__/scheduler.test.ts"
  rollback: "停 scheduler service；fetcher queue 仍能手动入队"
  acceptance:
    - "T1/T2/T3 信源在 00/06/12/18 触发抓取"
    - "模拟 1 条 7 天连续失败 → enabled=false"
    - "Vitest 集成测试 pass"
```

### T-M1-06 去重逻辑

```yaml
task: T-M1-06
  goal: "在 fetcher 入库前过滤重复 item（url 唯一 + 标题+发布日期二次去重）"
  constraints:
    - "url 唯一索引由 schema 保证"
    - "标题+日期去重在应用层（避免 utm 参数变化）"
    - "不允许跨 source 误判（比如转载）"
  ask_agent_first:
    - "restate design.md §4.3"
    - "outline 二次去重命中规则（trim title + same yyyy-mm-dd）"
    - "list 测试用例（同 url / 同标题不同 url / 不同标题）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/dedup.ts"
    - "apps/worker/src/__tests__/dedup.test.ts"
  rollback: "revert PR；重复条目可手动 SQL 删"
  acceptance:
    - "同 url 第二次抓取被跳过"
    - "同标题+日期跨 source 各保留一条"
    - "覆盖率 100%"
```

### T-M1-07 信源 admin API（CRUD）

```yaml
task: T-M1-07
  goal: "提供 GET/POST/PUT/DELETE /api/sources，editor+ 权限，输入 Zod 校验"
  constraints:
    - "POST 必须校验 fetcher_type 与 config 匹配"
    - "DELETE 软删（enabled=false），不真删（避免历史 items 失去外键）"
    - "字段命名 camelCase JSON / snake_case DB"
  ask_agent_first:
    - "restate design.md §9 + style-invariants §5"
    - "outline Zod schema"
    - "list 错误码（VALIDATION / FORBIDDEN / NOT_FOUND）"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/sources/route.ts"
    - "apps/web/app/api/sources/[id]/route.ts"
    - "apps/web/lib/api/sources-schema.ts"
    - "apps/web/app/api/sources/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "POST 合法 source → 201 + body 含 id"
    - "POST 非法 fetcher_type → 400 + VALIDATION code"
    - "viewer 角色访问 → 403"
    - "DELETE 后 GET 仍能取到（enabled=false）"
```

### T-M1-08 信源后台页

```yaml
task: T-M1-08
  goal: "/admin/sources 页：Tab T1/T2/T3 + 表格（名称/url/状态/最近成功/失败次数）+ CRUD 弹窗"
  constraints:
    - "RSC 拉数据；交互层 client component"
    - "不直接访问 DB，走 /api/sources"
    - "sources.config JSON 用 monaco-editor 或 textarea 编辑"
  ask_agent_first:
    - "restate requirements FR-09 + style-invariants §12"
    - "outline 路由结构 + shadcn 组件清单"
    - "list 视觉等待用户原型（Excalidraw/Figma）"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/sources/page.tsx"
    - "apps/web/app/(admin)/admin/sources/source-table.tsx"
    - "apps/web/app/(admin)/admin/sources/source-form.tsx"
    - "apps/web/components/(admin)/*"
  rollback: "revert PR；API 仍可用"
  acceptance:
    - "管理员可 CRUD 信源"
    - "失败 ≥ 7 天的源高亮红色"
    - "Playwright E2E：登录 → CRUD 流程通过"
```

### T-M1-09 信源 v1 seed (37 条)

```yaml
task: T-M1-09
  goal: "把 DMA-14 候选清单（T1=11 / T2=17 / T3=9 = 37 条）写入 packages/db/migrations/<n>_sources_seed.sql；运行时验证 RSS / HTML 列表页可达"
  constraints:
    - "seed 入版本控制（不含敏感字段）"
    - "ON CONFLICT (url) DO NOTHING idempotent"
    - "对每条做 curl 可达性测试，不可达的标 enabled=false 并加注释"
  ask_agent_first:
    - "restate DMA-14 v1 候选清单"
    - "outline 可达性测试脚本"
    - "list 失败 fallback（从 rss → html 降级建议）"
  owner: "agent-db"
  scope:
    - "packages/db/migrations/0004_sources_seed.sql"
    - "packages/db/scripts/verify-sources.ts"
  rollback: "DELETE FROM sources WHERE name IN (<候选名单>)"
  acceptance:
    - "37 条全部插入成功"
    - "verify-sources.ts 报告 ≥ 80% 可达（首批运行）"
    - "不可达条目 enabled=false 且注释原因"
```

### T-M1-10 代理池 + UA 轮换（DMA-23 R3 fix）

```yaml
task: T-M1-10
  goal: "实现代理池 + UA 轮换模块，给 fetcher 提供 { proxy, userAgent } 抽签 + 失败切换接口；解决政府类 T1 站反爬封锁问题"
  constraints:
    - "代理列表从 docker secret PROXY_LIST_FILE（每行 host:port[:user:pass]）读"
    - "支持 HTTP / HTTPS / SOCKS5"
    - "UA 池：默认 'FE-Radar Bot'（合规优先）+ 真实浏览器 UA 轮换池（仅政府类 source 启用，sources.config.useRealUa=true）"
    - "代理 health check：默认每 5min 探测，失败超 3 次自动 disable；探测周期 / 失败阈值通过 env (`PROXY_HEALTH_INTERVAL_SEC` / `PROXY_HEALTH_FAIL_THRESHOLD`) 可调（DMA-24 B3）"
    - "admin 后台 `/admin/dashboard` 显示 disabled 代理列表 + 一键 re-enable 按钮（实施合并到 T-M5-01）"
    - "fetcher 失败（429/403/连续超时）时调 acquire(retry=true) 拿不同代理"
    - "全程 robots.txt 仍遵守；代理池**不**用于绕过 robots（合规要求）"
    - "用户能在 admin 后台关闭代理池（feature flag PROXY_POOL_ENABLED）"
  ask_agent_first:
    - "restate Antigravity DMA-23 R3 + design.md §16 风险 row 2"
    - "outline 代理池接口（acquire / release / report-failure）"
    - "list 测试用例（健康代理切换 / 全部代理失败 fallback / robots.txt 不绕过验证）"
    - "list 法务边界（仅用于公开信源 / 不爬登录墙后内容）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/lib/proxy-pool.ts"
    - "apps/worker/src/lib/ua-pool.ts"
    - "apps/worker/src/lib/__tests__/*"
    - "deploy/secrets/proxy_list.example"
  rollback: "PROXY_POOL_ENABLED=false → fetcher 退化到直连，行为等价 v0.1"
  acceptance:
    - "对国家能源局列表页（T1-01）连续抓 7 天成功率 ≥ 95%"
    - "代理失败自动 health-check 标 disabled"
    - "proxy 全失效时 fetcher 抛 ProxyExhaustedError 触发告警，不静默失败"
    - "robots.txt 抓取规则仍生效（验证：测试 User-agent: * Disallow: /private 路径不被抓）"
```

---

## 4. M2 · Pipeline 与评分（2026-06-14）

### T-M2-01 packages/llm 共享 SDK 接口

```yaml
task: T-M2-01
  goal: "定义统一 LLMClient 接口（chat / embedding / json_schema_chat）+ retry 封装 + 计费/调用量统计"
  constraints:
    - "DeepSeek/Kimi/Qwen 都用 OpenAI SDK 兼容协议"
    - "重试 2 次指数退避"
    - "调用量写 Pino info 日志（token 数 / latency）"
  ask_agent_first:
    - "restate design.md §5.1 + style-invariants §11"
    - "outline interface 设计 + 错误层级"
    - "list 测试方法（mock fetch / vcr）"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/client.ts"
    - "packages/llm/src/types.ts"
    - "packages/llm/src/index.ts"
    - "packages/llm/src/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "interface 类型导出"
    - "retry 测试覆盖率 ≥ 95%"
```

### T-M2-02 Qwen client

```yaml
task: T-M2-02
  goal: "实现 packages/llm/src/clients/qwen.ts 调用本地 Qwen3.6 27B（OpenAI 协议）"
  constraints:
    - "QWEN_BASE_URL env 读取"
    - "embedding 维度 1024"
    - "JSON schema 强约束（用 response_format）"
  ask_agent_first:
    - "restate design.md §5.1 LLM 分工 Qwen 部分"
    - "outline 失败 fallback（超时切 DeepSeek）"
    - "list 测试用例"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/clients/qwen.ts"
    - "packages/llm/src/clients/__tests__/qwen.test.ts"
  rollback: "revert PR"
  acceptance:
    - "embedding 长度 = 1024"
    - "chat JSON schema 校验通过"
```

### T-M2-03 DeepSeek client

```yaml
task: T-M2-03
  goal: "实现 packages/llm/src/clients/deepseek.ts 调 DeepSeek V4 Pro API（评分/摘要/翻译）"
  constraints:
    - "API key 从 env DEEPSEEK_API_KEY 读"
    - "评分必须 response_format json_schema"
    - "成本日志（每条 token + 累计 cost）"
  ask_agent_first:
    - "restate design.md §5.1"
    - "outline schema 与 prompt 模板路径"
    - "list 测试用例（合法 / schema 失败 / 超时）"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/clients/deepseek.ts"
    - "packages/llm/src/clients/__tests__/deepseek.test.ts"
  rollback: "revert PR"
  acceptance:
    - "返回 5 维分数 + summary + translation 结构正确"
    - "schema 失败重试 2 次后兜底默认值"
```

### T-M2-04 Kimi client

```yaml
task: T-M2-04
  goal: "实现 packages/llm/src/clients/kimi.ts 调 Kimi K2.6 API（200K context · 用于日报）"
  constraints:
    - "context limit 200K token"
    - "API key 从 env KIMI_API_KEY 读"
  ask_agent_first:
    - "restate design.md §5.1 Kimi 部分"
    - "outline 长 context 拼接策略"
    - "list 测试用例"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/clients/kimi.ts"
    - "packages/llm/src/clients/__tests__/kimi.test.ts"
  rollback: "revert PR"
  acceptance:
    - "可送入 50K token 输入并返回结果"
    - "成本日志正确"
```

### T-M2-05 BullMQ 流水线骨架

```yaml
task: T-M2-05
  goal: "注册 7 个 queue（fe:fetch / fe:prefilter / fe:ner / fe:scorer / fe:embedder / fe:cluster / fe:curator）+ FlowProducer 串联 8 阶段"
  constraints:
    - "queue 命名 fe:<stage>"
    - "FlowProducer 保证 fetch → prefilter → ner → scorer → embedder → cluster → curator 串行"
    - "每个 queue 默认 retry 3 次"
  ask_agent_first:
    - "restate design.md §5 pipeline + style-invariants §10"
    - "outline 流程图"
    - "list 测试方法"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/queues.ts"
    - "apps/worker/src/flows.ts"
    - "apps/worker/src/__tests__/queues.test.ts"
  rollback: "停 worker；queue 数据保留在 Redis"
  acceptance:
    - "FlowProducer 入队一条 fetch job 后能串到 curator"
    - "中间 stage 失败导致 flow 暂停（不下推）"
```

### T-M2-06 prefilter job

```yaml
task: T-M2-06
  goal: "用 Qwen 判断 item 是否行业相关（输出 is_industry_related: bool），失败 fallback DeepSeek"
  constraints:
    - "prompt ≤ 200 行"
    - "失败兜底 unknown，保留 item，不进精选"
    - "调用走 packages/llm 封装"
    - "调 LLM 前必经 T-M2-14 scrubber（脱敏；R1 fix）；调本地 Qwen 也走，保证一致策略"
  ask_agent_first:
    - "restate design.md §5 prefilter"
    - "outline prompt 设计 + few-shot"
    - "list 测试用例（电力新闻 / 八卦 / 边界）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/prefilter.ts"
    - "packages/llm/src/prompts/prefilter.ts"
    - "apps/worker/src/jobs/__tests__/prefilter.test.ts"
  rollback: "revert PR；queue 暂停"
  acceptance:
    - "100 条人工标注样本 accuracy ≥ 80%"
    - "失败 fallback 路径覆盖测试"
```

### T-M2-07 NER job + entities 词典加载

```yaml
task: T-M2-07
  goal: "Qwen + entities 词典联合抽取 7 类实体（company/product/policy/region/money/event_type/project_type）"
  constraints:
    - "词典优先匹配（性能）"
    - "LLM 补充未登录词"
    - "结果写 item_entities 表"
  ask_agent_first:
    - "restate requirements §8 NER + design §5 ner"
    - "outline 词典加载策略（启动时全表加载到内存 + 5min 缓存刷新）"
    - "list 测试用例（标准号 / 政策号 / 公司别名）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/ner.ts"
    - "apps/worker/src/lib/entities-dict.ts"
    - "packages/llm/src/prompts/ner.ts"
    - "apps/worker/src/jobs/__tests__/ner.test.ts"
  rollback: "revert PR"
  acceptance:
    - "对 50 条人工标注样本 entity recall ≥ 75%"
    - "policy 类型实体识别正则正确"
```

### T-M2-08 scorer job

```yaml
task: T-M2-08
  goal: "DeepSeek 输出 D1/D3/D4/D5（不出 D2，由 curator 算）+ summary_zh + translation_zh + category"
  constraints:
    - "JSON schema 强约束"
    - "失败重试 2 次后跳过本条"
    - "category ∈ requirements §7.3 的 5 类"
    - "调 DeepSeek 前必经 T-M2-14 scrubber（公网 LLM 强制脱敏；R1 fix）"
    - "若 scrubber 命中告警等级 'block'（含明确个人信息 / 内网 IP）→ 该 item 跳过 LLM，标 quota_state=admitted + summary_zh='[需人工脱敏]'"
  ask_agent_first:
    - "restate design.md §6.1"
    - "outline prompt + few-shot"
    - "list 测试用例（含错误 schema 输出）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/scorer.ts"
    - "packages/llm/src/prompts/scoring.ts"
    - "apps/worker/src/jobs/__tests__/scorer.test.ts"
  rollback: "revert PR"
  acceptance:
    - "100 条人工抽检 score 均方误差 ≤ 15"
    - "JSON schema 失败兜底覆盖"
```

### T-M2-09 embedder job + pgvector 索引

```yaml
task: T-M2-09
  goal: "Qwen embedding 1024 维写 item_analysis.embedding + 创建向量索引（ivfflat 或 HNSW，benchmark 后定）"
  constraints:
    - "title + summary 拼接送入；先经 T-M2-14 scrubber"
    - "**M2 实施前 benchmark ivfflat(100/200) vs HNSW(m=16,ef=64)** 在 50K + 500K 条数据上的精度（recall@10）和 build/query 延迟，结果写 PR description（DMA-23 E1 fix）"
    - "选定后 lists / m / ef_construction 参数固化在 migration 注释里"
    - "失败重试 3 次"
  ask_agent_first:
    - "restate design.md §5 embedder + §7 cluster"
    - "outline 索引创建时机（migration 还是 admin trigger）"
    - "list 性能测试（10K 条 embedding 入库时间）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/embedder.ts"
    - "packages/db/migrations/0005_pgvector_index.sql"
    - "apps/worker/src/jobs/__tests__/embedder.test.ts"
  rollback: "drizzle-kit migrate down 0005"
  acceptance:
    - "embedding 维度 = 1024"
    - "EXPLAIN 显示 ivfflat 命中"
    - "10K 条入库 < 5min（本地 Qwen）"
```

### T-M2-10 cluster job

```yaml
task: T-M2-10
  goal: "实现 packages/core/cluster.ts：cosine ≥ 0.85 加入既有簇 否则建簇 + 主条选举（T1>T2>T3 → 早 → 长）"
  constraints:
    - "纯函数，输入 embedding + 候选簇 list"
    - "不直连 DB；DB 装配在 apps/worker"
    - "100% 测试覆盖"
    - "**worker 装配层引入 Redis 分布式锁**（key=`cluster:create:lock`，5s TTL）防止多 worker 并发为相似 item 创建多簇（DMA-23 E2 fix）"
    - "锁的 acquire/release 用 Lua 脚本保证原子；失败时退到 backoff 100ms 重试 3 次"
  ask_agent_first:
    - "restate design.md §7"
    - "outline cosine 计算 + 主条选举算法"
    - "list 测试用例（边界相似度 / 多候选 / 同 tier 同时间）"
  owner: "agent-core"
  scope:
    - "packages/core/src/cluster.ts"
    - "packages/core/src/__tests__/cluster.test.ts"
  rollback: "revert PR"
  acceptance:
    - "测试覆盖率 100%"
    - "1000 条人工聚类样本 ARI ≥ 0.7"
```

### T-M2-11 curator job

```yaml
task: T-M2-11
  goal: "实现 packages/core/curator.ts：D2_chain（NER 命中 + 关注圈代码计算）+ final score + alert_type + is_curated"
  constraints:
    - "D2_chain 必须代码算，不调 LLM"
    - "alert_type 调 packages/core/alert.ts:computeAlert"
    - "纯函数 + 100% 测试"
  ask_agent_first:
    - "restate design.md §6 + §11"
    - "outline 公式 + 阈值查 scoring_config"
    - "list 测试用例（命中 C1 / safety / policy / 普通）"
  owner: "agent-core"
  scope:
    - "packages/core/src/curator.ts"
    - "packages/core/src/scoring.ts"
    - "packages/core/src/alert.ts"
    - "packages/core/src/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "测试覆盖率 100%"
    - "C1 命中条目 alert_type='own' 100%"
    - "scoring_config 改阈值后 is_curated 跟着变（动态读 DB）"
```

### T-M2-12 quota Lua + admit + drainBacklog

```yaml
task: T-M2-12
  goal: "实现 packages/core/quota.ts：admitToScoring（Lua 双计数器）+ drainBacklog（7 天老化转 dropped_quota_expired）"
  constraints:
    - "Lua 脚本原子化"
    - "key TTL 90000s"
    - "仅成功 admit 时 incr"
    - "100% 测试覆盖（用 testcontainers redis）"
    - "**饥饿监控指标**（DMA-23 E3 fix）：暴露 `priority_backlog_age_p95_seconds` / `priority_backlog_size` 指标，由 T-M5-01 Dashboard 消费；阈值告警：priority backlog 中 fetched_at > 24h 的条目占比 > 30% → 红色"
  ask_agent_first:
    - "restate design.md §5.1 v0.6 fix"
    - "outline Lua 脚本边界（priority 200 → normal 1300）"
    - "list 测试用例（并发 / 跨日 / backlog 老化）"
  owner: "agent-core"
  scope:
    - "packages/core/src/quota.ts"
    - "packages/core/src/priority.ts"
    - "packages/core/src/__tests__/quota.test.ts"
  rollback: "revert PR"
  acceptance:
    - "测试覆盖率 100%"
    - "并发 100 条 admit 不超额"
    - "跨日测试通过（mock 时钟）"
    - "7 天老化转 dropped_quota_expired"
```

### T-M2-13 评分回测脚本

```yaml
task: T-M2-13
  goal: "scripts/scoring-backtest.ts：对历史 N 条 items 跑当前 vs 候选 scoring_config，输出准确率/重合度对比"
  constraints:
    - "不写产线 DB，用只读连接"
    - "结果输出 markdown 报告"
  ask_agent_first:
    - "restate design.md §15 测试策略"
    - "outline 报告字段（accuracy / curated_overlap / rank_kendall_tau）"
    - "list 性能（500 条 < 5min）"
  owner: "agent-core"
  scope:
    - "scripts/scoring-backtest.ts"
    - "scripts/README.md"
  rollback: "revert PR；脚本独立"
  acceptance:
    - "对 500 条历史样本输出 markdown 报告"
    - "覆盖 weights 与 thresholds 两类参数变更"
```

### T-M2-14 LLM scrubber 模块（DMA-23 R1 fix）

```yaml
task: T-M2-14
  goal: "实现 packages/core/scrubber.ts：在送任何 LLM（含本地 Qwen）前对内容做敏感数据识别 + 替换 + audit log"
  constraints:
    - "纯函数（输入 string + ctx → { cleaned, redactions, level }）"
    - "敏感类别：手机号 / 身份证 / 邮箱 / 内网 IP（10./172.16-31./192.168.）/ MAC / 内部项目代号词典"
    - "替换为占位符 `[REDACTED:<TYPE>:<HASH8>]`，hash 用于 audit 但不可逆"
    - "level: 'safe' / 'redacted' / 'block'（block = 命中明确 PII 数量超阈值，建议跳过 LLM）"
    - "audit log 不含原文，只含 redactions 计数与类别 + item_id"
    - "100% 测试覆盖"
    - "性能：1KB 文本 < 5ms"
  ask_agent_first:
    - "restate Antigravity DMA-23 R1 + design.md §5 scrubber 阶段（v0.7 引入）"
    - "outline 正则与词典 + 词典加载 (env SCRUBBER_PROJECT_DICT_FILE)"
    - "list 测试用例（手机号 / 内网 IP / 项目代号 / Unicode 边界 / 假阳性 markdown 链接）"
    - "list 法务边界（仅自动化辅助，不替代人工 review）"
  owner: "agent-core"
  scope:
    - "packages/core/src/scrubber.ts"
    - "packages/core/src/__tests__/scrubber.test.ts"
  rollback: "revert PR；T-M2-15 集成处可加 feature flag SCRUBBER_ENABLED 临时关闭（仅 dev）"
  acceptance:
    - "100 条人工 PII 样本召回率 ≥ 95%"
    - "假阳性率 ≤ 5%"
    - "audit log 无原文泄漏（grep 验证）"
    - "性能基准达标"
```

### T-M2-15 scrubber 接入 LLM 链（DMA-23 R1 fix）

```yaml
task: T-M2-15
  goal: "在所有调用 LLM 的位置（prefilter / scorer / daily-gen）前插入 scrubber，并返回 level=block 时的 fallback 策略"
  constraints:
    - "插入点固定为 packages/llm 封装层（统一拦截，不在每个 job 散布）"
    - "block 命中的 item：跳过 LLM 不评分，标 quota_state=admitted（不消耗 backlog 配额）+ summary_zh='[需人工脱敏]'，列入 admin Dashboard 待处理表"
    - "redacted item：用 cleaned 文本送 LLM；返回结果上若引用了 [REDACTED] 占位符则保留（不还原）"
    - "scrubber 失败（异常）→ 默认 block（fail-safe）"
    - "PROD 环境强制启用，DEV 可关闭"
  ask_agent_first:
    - "restate T-M2-14 接口 + design §5 流水线 v0.7"
    - "outline 在 packages/llm/client.ts 的 wrap 位置"
    - "list 受影响 job (prefilter / scorer / daily-gen / 后续可能的 NER LLM 兜底)"
    - "list 测试方法（mock LLM client + 注入含 PII 文本验证未泄漏）"
  owner: "agent-llm"
  scope:
    - "packages/llm/src/client.ts (wrap 注入)"
    - "packages/llm/src/middleware/scrubber.ts"
    - "packages/llm/src/__tests__/scrubber-integration.test.ts"
  rollback: "回滚到 T-M2-14 之前；feature flag 关 scrubber"
  acceptance:
    - "集成测试 1000 条 PII 文本中 0 条原文进入 LLM 调用 payload"
    - "block 类 item 在 dashboard 待处理表显示"
    - "PROD env scrubber 关闭时启动报错（fail-fast）"
```

---

## 5. M3 · 前端核心页面（2026-06-22）

### T-M3-01 时间线 API

```yaml
task: T-M3-01
  goal: "GET /api/timeline?cursor=&filter= 返回时间线条目（cursor 分页 + 多维筛选 + 折叠主条）"
  constraints:
    - "cursor base64({ scoredAt, id })"
    - "filter ∈ category / circle / tier / event_type / alert_type"
    - "聚簇折叠：仅返回 lead_item，附 N 关联"
    - "**默认排除 quota_state ∈ ('pending_over_quota','dropped_quota_expired','dropped_filter')**（仅展示已评分内容；DMA-24 B2）"
    - "**block 类 item**（quota_state=admitted 但 summary_zh='[需人工脱敏]'）默认排除；管理员通过 ?includeBlocked=true + admin 权限可见（DMA-24 B2）"
  ask_agent_first:
    - "restate requirements FR-01/04/05 + design §9"
    - "outline Drizzle 查询 + 索引利用"
    - "list 性能（p95 < 500ms）"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/timeline/route.ts"
    - "apps/web/lib/api/timeline-schema.ts"
    - "apps/web/app/api/timeline/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "默认 50 条 / 页"
    - "filter 多维组合返回正确"
    - "p95 < 500ms（10K 条数据）"
```

### T-M3-02 时间线页

```yaml
task: T-M3-02
  goal: "/ (默认时间线) 页：RSC 拉首页 + 客户端 TanStack Query 翻页 + 筛选 chip + 折叠主条 + 关注圈色条"
  constraints:
    - "RSC 优先；交互 client component"
    - "筛选状态写 URL search params"
    - "等待用户 UI 原型对齐视觉"
  ask_agent_first:
    - "restate requirements FR-01/04/05 + style-invariants §12"
    - "outline 组件树（TimelineList / TimelineCard / FilterBar）"
    - "list 视觉等待用户原型"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(timeline)/page.tsx"
    - "apps/web/components/timeline/*"
    - "apps/web/hooks/use-timeline.ts"
  rollback: "revert PR"
  acceptance:
    - "首屏 ≤ 50 条 + 翻页加载"
    - "筛选写 URL，刷新保留"
    - "Playwright E2E 翻页/筛选通过"
```

### T-M3-03 精选 Tab 页

```yaml
task: T-M3-03
  goal: "/curated 页：仅展示 is_curated=true 的 lead_item，按 quality_score 降序"
  constraints:
    - "复用 timeline API 的 ?filter=curated（继承 block / pending / dropped 排除规则；DMA-24 B2）"
    - "默认按 category Tab 切换（5 类）"
  ask_agent_first:
    - "restate requirements FR-02"
    - "outline 与 timeline 页复用边界"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(timeline)/curated/page.tsx"
    - "apps/web/components/curated/*"
  rollback: "revert PR"
  acceptance:
    - "默认显示 ≥ 20 条精选条目"
    - "Tab 切换 5 类正确过滤"
```

### T-M3-04 全文搜索

```yaml
task: T-M3-04
  goal: "/search 页 + GET /api/search?q=&filter= ：zhparser FTS + ILIKE fallback + 多维 filter chip"
  constraints:
    - "API 与 UI 同 task（小范围）"
    - "中英双语 query 都支持"
    - "p95 < 1s（10K 条）"
    - "默认排除 block / pending / dropped 状态条目（与 timeline 一致；DMA-24 B2）"
  ask_agent_first:
    - "restate requirements FR-06"
    - "outline FTS 查询语法 + 高亮"
    - "list 性能 + zhparser 边界"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/search/page.tsx"
    - "apps/web/app/api/search/route.ts"
    - "apps/web/components/search/*"
  rollback: "revert PR"
  acceptance:
    - "搜 \"远东\" 返回相关条目"
    - "搜 \"GB/T 12706\" 命中 NER policy 实体"
    - "p95 < 1s"
```

### T-M3-05 详情页 / 弹层 + 聚簇展开

```yaml
task: T-M3-05
  goal: "条目详情：评分维度 / 实体 / 摘要 / 聚簇内全部 item 展开"
  constraints:
    - "用 shadcn Dialog 弹层（不是新页）"
    - "聚簇展开复用 cluster_items"
    - "**API 默认拒绝**含 PII 风险或未评分的 item：quota_state ∈ ('pending_over_quota','dropped_quota_expired','dropped_filter') 或 summary_zh='[需人工脱敏]' → 返回 403/404（v0.8 E1 fix · 防 ID 暴力枚举越权访问）"
    - "admin 通过 `?includeBlocked=true` 显式请求才返回（与 timeline API 一致）"
  ask_agent_first:
    - "restate requirements FR-04 + design §7.3"
    - "outline 弹层结构"
    - "list 视觉等待用户原型"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/api/items/[id]/route.ts"
    - "apps/web/components/timeline/item-detail-dialog.tsx"
  rollback: "revert PR"
  acceptance:
    - "点击条目弹层显示 5 维分数 / 实体 / 摘要"
    - "聚簇 +N 关联可展开"
```

### T-M3-06 反馈机制

```yaml
task: T-M3-06
  goal: "POST /api/items/:id/feedback + 详情弹层 +1/-1 + 文本备注"
  constraints:
    - "vote ∈ {-1, 0, 1}"
    - "限同用户每条 1 票（UNIQUE (item_id, user_id)）"
  ask_agent_first:
    - "restate requirements FR-11"
    - "outline schema 调整（feedbacks UNIQUE）"
    - "list 测试用例"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/items/[id]/feedback/route.ts"
    - "apps/web/components/timeline/feedback-buttons.tsx"
    - "packages/db/migrations/0006_feedbacks_unique.sql"
  rollback: "drizzle-kit migrate down 0006"
  acceptance:
    - "用户提交反馈写 DB"
    - "二次提交覆盖第一次（UPSERT）"
    - "未登录提交返回 401"
```

### T-M3-07 原文跳转 + 来源标识 + 关注圈色条

```yaml
task: T-M3-07
  goal: "条目卡片：点击标题 target=_blank 跳第三方原文 + 来源 logo/名称 + 关注圈/告警 type 色条"
  constraints:
    - "rel=noopener noreferrer"
    - "色条规则见 requirements §9（own 红/橙/黄；safety 灰；policy 蓝）"
  ask_agent_first:
    - "restate requirements FR-12 + §9"
    - "outline TimelineCard 视觉规范（等用户原型）"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/components/timeline/timeline-card.tsx"
    - "apps/web/components/timeline/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "点击跳第三方"
    - "色条按 alert_type 渲染"
```

### T-M3-08 全局 Layout（导航 + Badge + 用户菜单）

```yaml
task: T-M3-08
  goal: "全局 layout：左侧导航（时间线/精选/搜索/告警/日报/后台）+ 顶栏 Badge（own/safety/policy 三计数）+ 右上用户菜单"
  constraints:
    - "Badge 60s 轮询 /api/alerts/count"
    - "未登录隐藏用户菜单显示登录按钮"
  ask_agent_first:
    - "restate requirements §9 + design §11"
    - "outline 布局组件 + RBAC 显隐"
    - "list 视觉等待用户原型"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/layout.tsx"
    - "apps/web/components/layout/*"
  rollback: "revert PR"
  acceptance:
    - "Badge 显示当日 own/safety/policy 三类数"
    - "viewer 看不到 /admin 入口"
```

---

## 6. M4 · 告警 · 日报 · 钉钉 SSO（2026-06-27）

### T-M4-01 告警 API + Badge count

```yaml
task: T-M4-01
  goal: "GET /api/alerts?type=&level=&source=&cursor= + GET /api/alerts/count（design §9）"
  constraints:
    - "type ∈ own/safety/policy；level ∈ L1/L2/L3"
    - "count 端点返回 { own, safety, policy }"
  ask_agent_first:
    - "restate design.md §9 + §11"
    - "outline 查询 + cache（Redis 30s）"
    - "list 性能"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/alerts/route.ts"
    - "apps/web/app/api/alerts/count/route.ts"
    - "apps/web/lib/api/alerts-schema.ts"
    - "apps/web/app/api/alerts/__tests__/*"
  rollback: "revert PR"
  acceptance:
    - "filter 多维组合返回正确"
    - "count 端点 p95 < 100ms"
```

### T-M4-02 告警页（多通道筛选）

```yaml
task: T-M4-02
  goal: "/alerts 页：双层筛选（type × level × source × time）+ 倒序时间线"
  constraints:
    - "默认显示当日全部告警"
    - "Tab 切 type"
  ask_agent_first:
    - "restate requirements §9.3 + design §11.2"
    - "outline 筛选组件"
    - "list 视觉等待用户原型"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(timeline)/alerts/page.tsx"
    - "apps/web/components/alerts/*"
  rollback: "revert PR"
  acceptance:
    - "三通道筛选正确"
    - "Playwright E2E 通过"
```

### T-M4-03 daily-gen job

```yaml
task: T-M4-03
  goal: "BullMQ daily-gen job：每天 08:00 用 Kimi 200K 生成 5 版块日报，写 daily_reports 表"
  constraints:
    - "5 版块 = 政策 / 市场 / 技术 / 项目 / 公司（与 scoring category 对齐）"
    - "失败延后 30min 重试"
    - "prompt ≤ 200 行"
    - "调 Kimi 前必经 T-M2-14 scrubber 对所有摘要逐条脱敏（公网 LLM 强制；R1 fix）"
    - "若汇总后命中 block 类 item ≥ 5 → 暂停日报生成 + 告警 admin（避免发出含 PII 日报）"
  ask_agent_first:
    - "restate requirements FR-03 + design §5"
    - "outline prompt 输入（前 24h curated items 摘要拼接）"
    - "list 测试用例"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/daily-gen.ts"
    - "packages/llm/src/prompts/daily-report.ts"
    - "apps/worker/src/jobs/__tests__/daily-gen.test.ts"
  rollback: "停 daily-gen job；前端可显示前一天日报"
  acceptance:
    - "每天 08:00 触发并生成 daily_reports 一行"
    - "5 版块 JSON 结构正确"
    - "失败重试覆盖测试"
```

### T-M4-04 日报展示页

```yaml
task: T-M4-04
  goal: "/daily 页：今日日报 + 历史日报选择器 + 5 版块卡片渲染"
  constraints:
    - "用 GET /api/daily?date= 拉数据"
    - "Markdown 渲染用 react-markdown + 严格 schema"
  ask_agent_first:
    - "restate requirements FR-03"
    - "outline 视觉等待用户原型"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(daily)/daily/page.tsx"
    - "apps/web/app/api/daily/route.ts"
    - "apps/web/components/daily/*"
  rollback: "revert PR"
  acceptance:
    - "今日日报正确展示 5 版块"
    - "历史日报 7 天可切"
```

### T-M4-05 钉钉 OAuth provider

```yaml
task: T-M4-05
  goal: "Auth.js 增加钉钉 provider：扫码登录 → unionid → 拉 name+dept（不拉手机号）→ 调用 T-M4-05a 合并策略 upsert users"
  constraints:
    - "AppKey/AppSecret 从 docker secret 读"
    - "Callback URL 必须在钉钉应用白名单"
    - "不存手机号"
    - "**不直接 INSERT users**，必须经 T-M4-05a 的 mergeOrCreateUser() 函数（DMA-23 R2 fix）"
  ask_agent_first:
    - "restate requirements §10.1 + design §10b/§10c"
    - "outline 钉钉 OpenAPI 调用顺序 + 调 mergeOrCreateUser 时机"
    - "list 测试方法（mock 钉钉 API）"
  owner: "agent-auth"
  scope:
    - "apps/web/auth.ts (扩 provider)"
    - "apps/web/app/api/auth/dingtalk/*"
    - "apps/web/lib/auth/dingtalk-provider.ts"
  rollback: "revert PR；本地账号登录不受影响"
  acceptance:
    - "扫码登录成功 → 经 mergeOrCreateUser 后 users 表正确（新建 OR 合并到已有）"
    - "未拉手机号字段（grep 验证）"
```

### T-M4-05a 账号合并策略（DMA-23 R2 fix）

```yaml
task: T-M4-05a
  goal: "实现 mergeOrCreateUser({ unionid, name, dept })：在新钉钉用户首次登录时，按规则与已有本地账号合并；保证 RBAC 角色不丢失、不产生碎片化账号（v0.8 删 mobileHash 参数）"
  constraints:
    - "合并匹配键（按优先级，v0.8 R1 简化）：1. dingtalk_id=unionid → 直接登录；2a. name+dept 唯一匹配且 dingtalk_id 空 → 自动合并；2b. name+dept 多匹配 → 写 merge_conflicts 表 + 兜底新建 dingtalk-only；3. 无匹配 → 新建 dingtalk-only"
    - "**禁止**用钉钉手机号或 mobile_hash 做匹配（v0.8 R1：钉钉 OAuth 不返回手机号 / requirements §10.2 不拉手机号）"
    - "合并保留：role（取 max(本地, 默认 viewer)）、created_at（取 min）、所有 feedbacks、所有 audit log"
    - "schema：users 加 `merged_at TIMESTAMPTZ` + `merged_from_user_id BIGINT`（追溯被合并方）；不含 mobile_hash"
    - "操作必须在事务里（防并发同一用户双登录撞 race）"
    - "100% 测试覆盖（用 testcontainers）"
  ask_agent_first:
    - "restate Antigravity DMA-23 R2 + design §10c (v0.7 引入)"
    - "outline mergeOrCreateUser 的决策树 + 冲突处理"
    - "list 测试用例（自动合并 / 多候选冲突 / 重登录幂等 / RBAC 升降级）"
    - "list 边界：admin 后台手动合并 API 是否本 task 内做（建议拆给 T-M5-03 用户管理）"
  owner: "agent-auth"
  scope:
    - "apps/web/lib/auth/merge.ts"
    - "apps/web/lib/auth/__tests__/merge.test.ts"
    - "packages/db/migrations/0007_users_merge.sql"
  rollback: "drizzle-kit migrate down 0007 + revert PR；钉钉登录退回纯 upsert（接受 R2 风险）"
  acceptance:
    - "10 条人工标注合并样本决策正确率 100%"
    - "并发同 unionid 双登录测试无重复行（DB UNIQUE 约束 + 事务）"
    - "合并后 RBAC role 不降级"
    - "audit log 完整记录每次合并的 from/to user_id"
```

### T-M4-06 实体词典后台

```yaml
task: T-M4-06
  goal: "/admin/entities 页 + GET/POST/PUT/DELETE /api/entities：CRUD entities 表（含别名 + circle）"
  constraints:
    - "editor+ 权限"
    - "circle 仅对 type=company 可填"
    - "alias 数组校验"
  ask_agent_first:
    - "restate requirements FR-10"
    - "outline Zod schema + UI 表单"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/entities/page.tsx"
    - "apps/web/app/api/entities/route.ts"
    - "apps/web/app/api/entities/[id]/route.ts"
    - "apps/web/lib/api/entities-schema.ts"
  rollback: "revert PR"
  acceptance:
    - "CRUD 流程通过"
    - "type=company 必须选 circle"
```

### T-M4-07 alert_type 三通道色条与 UI 集成

```yaml
task: T-M4-07
  goal: "把 own/safety/policy 三通道色条扩展到 timeline、curated、search、alerts 全部页面，统一视觉"
  constraints:
    - "色条规则统一在 components/shared/alert-strip.tsx"
    - "无重复实现"
  ask_agent_first:
    - "restate requirements §9 + design §11.2"
    - "outline 共享组件抽取"
    - "list 视觉等待用户原型"
  owner: "agent-web-ui"
  scope:
    - "apps/web/components/shared/alert-strip.tsx"
    - "apps/web/components/{timeline,alerts,curated,search}/*（仅修补色条调用）"
  rollback: "revert PR"
  acceptance:
    - "全部页面色条统一"
    - "Storybook 或 Playwright 视觉回归通过"
```

### T-M4-08 钉钉登录 UI 集成

```yaml
task: T-M4-08
  goal: "/auth/login 页加 \"钉钉扫码登录\" 入口（M4+ 启用，M0–M3 隐藏）"
  constraints:
    - "feature flag 通过 env DINGTALK_ENABLED 控制"
    - "本地账号入口保留"
  ask_agent_first:
    - "restate requirements §10.0"
    - "outline 双登录入口布局"
    - "list 测试方法"
  owner: "agent-auth"
  scope:
    - "apps/web/app/auth/login/page.tsx (扩展)"
    - "apps/web/components/auth/dingtalk-button.tsx"
  rollback: "revert PR；env 标志可热切"
  acceptance:
    - "DINGTALK_ENABLED=true 时显示钉钉按钮"
    - "DINGTALK_ENABLED=false 时仅本地登录"
```

---

## 7. M5 · 后台 · 监控 · 上线（2026-06-30）

### T-M5-01 admin Dashboard

```yaml
task: T-M5-01
  goal: "/admin/dashboard 页：信源健康 / LLM 调用量 / pipeline 队列 / 聚类质量 / 反馈分布 / 告警计数 / backlog 健康（v0.6 F3）/ scrubber 待人工脱敏队列（v0.7 R1）/ 账号合并冲突列表（v0.7 R2）/ priority backlog 饥饿（v0.7 E3）"
  constraints:
    - "RSC 拉数；不引入 Prometheus"
    - "数据查 PG + Redis（BullMQ API）"
    - "刷新 30s"
    - "**新增 3 行（DMA-23 fix）**：scrubber block 队列待处理数 + 账号合并冲突待 admin confirm 数 + priority backlog 陈旧度（>24h 占比 / 阈值 30%）"
  ask_agent_first:
    - "restate design.md §14"
    - "outline 数据查询 + 缓存（30s redis）"
    - "list 性能（dashboard load < 2s）"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/dashboard/page.tsx"
    - "apps/web/app/api/dashboard/route.ts"
    - "apps/web/components/dashboard/*"
  rollback: "revert PR"
  acceptance:
    - "全部 7 类指标显示"
    - "backlog 阈值（>1000 或 >5d）触发红色提示"
```

### T-M5-02 评分配置后台

```yaml
task: T-M5-02
  goal: "/admin/scoring-config 页 + GET/PUT /api/scoring-config：admin 调权重/阈值/T_coef/C_coef，写 scoring_config 表"
  constraints:
    - "admin 权限"
    - "每次 PUT 写 updated_by"
    - "权重和必须为 1.00（前端 + 后端校验）"
  ask_agent_first:
    - "restate requirements §7.2 / §7.3 + design §6.3"
    - "outline 表单 + 校验"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/scoring-config/page.tsx"
    - "apps/web/app/api/scoring-config/route.ts"
    - "apps/web/lib/api/scoring-config-schema.ts"
  rollback: "revert PR；DB 已有 seed 默认值兜底"
  acceptance:
    - "调权重 sum != 1.00 返回 400"
    - "调完后 curator job 立即生效（10 条 e2e 验证）"
```

### T-M5-03 用户管理后台

```yaml
task: T-M5-03
  goal: "/admin/users 页：列表 / 修改角色 / 停用（软删）/ 合并钉钉 + 本地账号"
  constraints:
    - "admin 权限"
    - "自身角色不可降级（避免锁出）"
    - "合并：dingtalk_id 写到现有 username 行"
    - "**停用通过 `disabled_at`（v0.8 R2）**：UPDATE users SET disabled_at = now() WHERE id = ?；登录中间件检查 disabled_at IS NULL；禁止物理 DELETE（保留 feedbacks/audit log 引用）"
    - "停用自身需二次确认；最后一个 admin 不允许停用（避免锁系统）"
    - "Reactivate：UPDATE disabled_at = NULL"
  ask_agent_first:
    - "restate design.md §10b 末尾合并描述"
    - "outline 合并算法 + 冲突处理"
    - "list 测试用例"
  owner: "agent-web-ui"
  scope:
    - "apps/web/app/(admin)/admin/users/page.tsx"
    - "apps/web/app/api/users/route.ts"
    - "apps/web/app/api/users/[id]/route.ts"
  rollback: "revert PR"
  acceptance:
    - "admin 能改其他人角色"
    - "改自己 admin → viewer 被拒"
    - "合并账号成功"
```

### T-M5-04 admin backlog drill-down（v0.6 F3 实施）

```yaml
task: T-M5-04
  goal: "GET /api/admin/backlog?state=pending_over_quota|dropped_quota_expired&cursor= + UI 列表（admin 抽查）"
  constraints:
    - "admin 权限"
    - "只读"
    - "支持按 fetched_at 排序"
  ask_agent_first:
    - "restate design.md §9 v0.6 F3 占位 + §14 dashboard 关联"
    - "outline schema + UI"
    - "list 测试用例"
  owner: "agent-web-api"
  scope:
    - "apps/web/app/api/admin/backlog/route.ts"
    - "apps/web/app/(admin)/admin/backlog/page.tsx"
  rollback: "revert PR"
  acceptance:
    - "admin 看到当前 pending + 已 dropped 列表"
    - "viewer 访问返回 403"
```

### T-M5-05 90 天 cleanup job

```yaml
task: T-M5-05
  goal: "scheduler 每天 03:00 跑 4 步事务 cleanup（design.md §14）"
  constraints:
    - "事务原子（BEGIN/COMMIT）"
    - "失败回滚 + 告警"
    - "测试用 testcontainers + 时钟 mock"
  ask_agent_first:
    - "restate design.md §14 v0.5/v0.6 cleanup 块"
    - "outline 失败 fallback"
    - "list 测试用例（FK 联动 / cluster stale 误删）"
  owner: "agent-worker"
  scope:
    - "apps/worker/src/jobs/cleanup.ts"
    - "apps/worker/src/jobs/__tests__/cleanup.test.ts"
  rollback: "停 cleanup job；可手动跑 SQL"
  acceptance:
    - "10K 条数据 90 天后清理 < 5s"
    - "feedbacks 通过 CASCADE 联动删"
    - "stale clusters 删（lead_item_id IS NULL 且无 cluster_items）"
    - "活跃 cluster 不被误删"
```

### T-M5-06 Pino 日志 + 结构化输出

```yaml
task: T-M5-06
  goal: "全 service 接 Pino 结构化日志 + 输出到 stdout JSON + 生产 level=info"
  constraints:
    - "PII 黑名单（手机号 / token / cookie）"
    - "每条 log 必带 service / requestId / userId（如有）"
  ask_agent_first:
    - "restate style-invariants §7"
    - "outline pino-pretty 开发模式"
    - "list 验证方法（grep PII）"
  owner: "agent-infra"
  scope:
    - "packages/shared/src/logger.ts"
    - "apps/web/lib/logger.ts"
    - "apps/worker/src/logger.ts"
  rollback: "revert PR；console.log 兜底"
  acceptance:
    - "生产 stdout 是合法 JSON"
    - "grep -i 'mobile\\|password' 在 7 天日志中无命中"
```

### T-M5-07 E2E Playwright 关键路径

```yaml
task: T-M5-07
  goal: "Playwright E2E 覆盖：登录 / 时间线 / 精选 / 搜索 / 告警 / 日报 / admin 各路径"
  constraints:
    - "测试库用 testcontainers + seed 固定数据"
    - "CI 跑 main 分支，不阻塞 PR（避免慢）"
  ask_agent_first:
    - "restate requirements §14 验收标准"
    - "outline 测试用例清单（≥ 12 条）"
    - "list CI 时长目标（< 15min）"
  owner: "agent-infra"
  scope:
    - "tests/e2e/*"
    - ".github/workflows/integration.yml"
  rollback: "revert PR"
  acceptance:
    - "12 条 E2E 用例全绿"
    - "CI integration job < 15min"
```

### T-M5-08 上线验收 + Antigravity Code Review 修复

```yaml
task: T-M5-08
  goal: "Antigravity 跑 Code Review (Gate 2)，Codex 修 critical/major；走完 requirements §14 验收清单"
  constraints:
    - "critical 必须修 + 重审"
    - "major 必须修，不重审"
    - "minor 可延后"
  ask_agent_first:
    - "restate review-protocol §1.Gate2 + §4 severity rules"
    - "outline 修复优先级"
    - "list 验收清单 8 项"
  owner: "agent-infra"
  scope:
    - "全 repo（按 review findings 路由到对应 agent）"
  rollback: "回滚到上一 release tag"
  acceptance:
    - "Antigravity Code Review 0 critical"
    - "requirements §14 8 项验收全 ✅"
    - "release tag v1.0.0 推到内网 registry"
```

---

## 8. 跨 milestone 依赖（critical path）

```
T-M0-01 (monorepo)
  └─ T-M0-02 (drizzle schema)
       └─ T-M0-03 (scoring seed) · T-M0-07 (db client)
            └─ T-M0-04 (shared) · T-M0-05 (core skeleton)
                 ├─ T-M0-08 (auth) ← T-M0-06 (next.js)
                 ├─ T-M0-09 (docker) · T-M0-10 (CI)
                 │
                 ├─ M1: T-M1-01 → T-M1-10 (代理池) → T-M1-02..04 → T-M1-05/06/07 → T-M1-08
                 │       T-M1-09 (seed) 依赖 T-M1-01
                 │
                 ├─ M2: T-M2-01 → T-M2-02..04 (并行 LLM clients)
                 │       → T-M2-14 (scrubber 模块 · core) → T-M2-15 (scrubber 接 LLM 链 · llm)
                 │       → T-M2-05 (流水线骨架) → T-M2-06..09 (jobs · 部分并行 · 全部走 scrubber)
                 │       T-M2-10..12 (core 纯函数 · 并行)
                 │       T-M2-13 (回测) 依赖 T-M2-11/12
                 │
                 ├─ M3: M2 完毕后开 (T-M3-01 → T-M3-02..08 部分并行)
                 │
                 ├─ M4: M3 完毕后开
                 │       T-M4-01..02 (告警) / T-M4-03..04 (日报) / T-M4-05a (合并策略) → T-M4-05/08 (钉钉) / T-M4-06..07
                 │       三流并行；T-M4-05 必须等 T-M4-05a 完成才能调 mergeOrCreateUser
                 │
                 └─ M5: M4 完毕后开 (T-M5-01..04 / 05 / 06..07 / 08 顺序)
```

**并行最大化策略**：

- M0 完毕后 M1（worker）+ M2 packages/core 部分（quota/scoring/cluster/alert/scrubber）可并行起跑（packages/core 不依赖 db）
- M2 内部 LLM clients (T-M2-02/03/04) 完全并行；T-M2-14 可与之并行（packages/core 独立）
- M2 内部 core 纯函数 task (T-M2-10/11/12/14) 完全并行
- T-M2-15 是 sequential 关卡（T-M2-14 done + LLM clients done 才能开）
- T-M1-10 代理池是 M1 入口前置（T-M1-02..04 都依赖）
- T-M4-05a 合并策略与 T-M4-05 钉钉 provider 需顺序串行
- M3 / M4 内部页面 task 按文件分组并行（agent-web-ui 可拆 2 个并行 worker）

---

## 9. 风险登记（task 维度）

| Task     | 风险                              | 缓解                                                                                             |
| -------- | --------------------------------- | ------------------------------------------------------------------------------------------------ |
| T-M0-09  | zhparser pgvector 镜像不支持      | 自定义 Dockerfile + fallback ILIKE                                                               |
| T-M1-04  | playwright 内存泄漏               | BrowserContext 池化 + 周期 restart                                                               |
| T-M1-10  | 代理池法务边界（不绕 robots.txt） | 代码层断言 robots.txt 解析仍生效；admin 后台 feature flag 可一键关                               |
| T-M2-02  | 本地 Qwen GPU 容量不足            | 限速 + fallback DeepSeek                                                                         |
| T-M2-09  | ivfflat / HNSW 选型               | M2 实施前 50K + 500K benchmark + 报告（DMA-23 E1）                                               |
| T-M2-10  | 多 worker 并发建簇竞态            | Redis 分布式锁 + Lua 原子（DMA-23 E2）                                                           |
| T-M2-12  | Lua 脚本边界 + priority 饥饿      | 100% 测试 + 并发 fuzz + 陈旧度监控（DMA-23 E3）                                                  |
| T-M2-14  | scrubber 假阳性 / 假阴性          | 100 条人工样本召回 ≥ 95% / 假阳性 ≤ 5% + 持续迭代词典                                            |
| T-M2-15  | scrubber 性能压垮 LLM 吞吐        | 1KB < 5ms 基准；超阈值告警                                                                       |
| T-M3-04  | zhparser FTS 性能                 | 索引 + ILIKE fallback                                                                            |
| T-M4-05  | 钉钉 AppKey 回调白名单未配        | M0–M3 走本地账号，M4 启动前线下补                                                                |
| T-M4-05a | 合并冲突误判（碎片化账号）        | 仅自动合并强匹配（dingtalk_id 或 username+手机号），name+dept 同名走人工 confirm；audit log 完整 |
| T-M5-05  | cleanup 误删活跃 cluster          | testcontainers 集成测试 + 双层检查（无 cluster_items）                                           |

---

## 10. 进入下一阶段的条件

- ✅ 所有 60 个 task 字段齐全（goal/constraints/ask_agent_first/owner/scope/rollback/acceptance）
- ✅ Sub-agent 分工无重叠
- ✅ 跨 milestone 依赖图无环（含 v0.2 新增 T-M1-10 / T-M2-14/15 / T-M4-05a）
- ✅ 风险登记覆盖所有 high-risk task（含 DMA-23 R1/R2/R3 + E1/E2/E3）
- ✅ Antigravity DMA-23 全部 Critical + Edge 已闭合（v0.2）
- ⏳ 待 Antigravity 复审（Gate 1 二轮）
- ⏳ 待复审 pass 后 hand off 到 Codex 实施 M0
