# Linear Project Issues — FE-Radar — 远东控股行业情报雷达

Project URL: https://linear.app/dmarkubex/project/fe-radar-远东控股行业情报雷达-9536558a9480
Project State: backlog
Synced At: 2026-05-19T11:12:03.413645+00:00

## Active Board Snapshot

### DMA-52 — [REVIEW-CHORE] 工作树切原子 commit + 清理 untracked

- URL: https://linear.app/dmarkubex/issue/DMA-52/review-chore-工作树切原子-commit-清理-untracked
- Team: DMA
- State: Backlog (backlog)
- Priority: Medium
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:45:07.409Z

## 背景

工作树 41 modified + 14 untracked（+2483 / -551 行）混在一起，跨多个主题，无法整体合并。

## Commit 切分计划（按 CLAUDE.md `[T-Mx-XX]` / `[DMA-XX]` 约定）

1. **抽离共享 API helper**：`lib/api/cursor.ts`、`lib/api/item-visibility.ts` + `timeline-query.ts` / `alerts-query.ts` 去重
2. **worker 结构化日志**：`apps/worker/src/jobs/prefilter.ts`、`apps/worker/src/lib/robots.ts`、`packages/llm/src/client.ts`
3. **抽 worker runner**：`apps/worker/src/index.ts` + 新 `runner.ts` + `daily-gen.test.ts` mock 更新（注意：与 \[REVIEW-M2\] 协调，可一起做）
4. **UI 视觉系统大改**：所有 `app/**/page.tsx`、`components/**`、`globals.css`、`tailwind.config.ts`、`layout.tsx`、`middleware.ts`（与 \[REVIEW-M7\] 协调）
   * 建议再拆 3 子 commit：login / app-shell / 内容页（curated/daily/alerts/items）
5. **mock-mode dev 预览路径**：`lib/mock-mode.ts`、`lib/mock-data.ts`、`packages/db/scripts/seed-mock-data.ts`、`dev.sh`、`docker-compose.dev.yml` —— **依赖 \[REVIEW-C1+C2\] 先修完**
6. **信源 seed v2 新 migration**：由 \[REVIEW-M4\] 实施

## untracked 清理

- [ ] `AGENTS.md`（Codex CLI 损坏副本）→ 加 `.gitignore` 并删本地文件（handoff.md §2 已记）
- [ ] `apps/web/next-env.d.ts` 改动 revert（自动生成文件不该手工 diff）
- [ ] `design/*.html` + 多张 logo 图：移到 `docs/design/` 或独立分支，**确认** `mp20jvm9-logo_远东控股集团.png` **与** `public/fareast-logo.png` **版权 / 使

### DMA-51 — [REVIEW-M7] 修 middleware x-pathname 经 RSC headers() 的传递链

- URL: https://linear.app/dmarkubex/issue/DMA-51/review-m7-修-middleware-x-pathname-经-rsc-headers-的传递链
- Team: DMA
- State: Backlog (backlog)
- Priority: High
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:44:54.285Z

## 问题

**位置**：`apps/web/middleware.ts:57` 写 `x-pathname` 到 response header，`app/layout.tsx:14` 用 `headers()` 读取。

Next.js 中 `headers()` 返回的是**请求头**，不是 response header。`NextResponse.next()` 上 set 的 header 进不去 RSC。

后果：`layout.tsx` 里的 login-page-vs-shell 分支永远走不到 login 分支（因为读到的 `x-pathname` 永远为空 / 默认 `/`）。客户端 `AppShell` 通过 `usePathname()` 还能工作，但 RSC 层判断失效。

## 修复

```ts
// middleware.ts
const requestHeaders = new Headers(request.headers);
requestHeaders.set('x-pathname', request.nextUrl.pathname);
return NextResponse.next({ request: { headers: requestHeaders } });
```

## 验收

- [ ] `layout.tsx` 在 `/auth/login` 路径下读到正确的 `x-pathname`
- [ ] RSC 层 login 分支可达（写单元/集成测试）
- [ ] 整站手动走一遍 `/`, `/curated`, `/daily`, `/alerts`, `/auth/login`, `/admin/*` 行为正确

### DMA-50 — [REVIEW-M4] 信源 seed v2 改为新 migration（不要修改已落库的 0004）

- URL: https://linear.app/dmarkubex/issue/DMA-50/review-m4-信源-seed-v2-改为新-migration不要修改已落库的-0004
- Team: DMA
- State: Backlog (backlog)
- Priority: High
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:44:47.736Z

## 问题

**位置**：`packages/db/migrations/0004_sources_seed.sql`（已 modified）

直接改动已被环境应用过的 migration 文件违反 "migrations 不可变" 原则。任何已跑过 0004 的环境（dev / CI / staging）不会重跑这份 SQL，于是 seed 修订**只对全新环境生效**，老环境与新环境数据漂移。

## 修复

* 将 0004 还原到原始版本（`git checkout HEAD -- packages/db/migrations/0004_sources_seed.sql`）
* 把修订后的内容写到新 migration：`packages/db/migrations/0011_sources_seed_v2.sql`
* 用 `INSERT ... ON CONFLICT (url) DO UPDATE SET ... WHERE sources.disabled_at IS NULL` 形式更新已存在源，避免覆盖人工 disable
* 不可达源带 `disabled_at = NOW(), disabled_reason = '...'`

## 验收

- [ ] `git diff HEAD -- packages/db/migrations/0004_sources_seed.sql` 为空
- [ ] 新 migration 0011 落地，包含 2026-05-12 校验结果
- [ ] 在已跑过 0004 的库上跑 0011，结果与全新库一致
- [ ] admin 后台 disable 过的源不被覆盖

### DMA-49 — [REVIEW-M3] mock 写路径返回稳定语义（去掉伪 id 冲突）

- URL: https://linear.app/dmarkubex/issue/DMA-49/review-m3-mock-写路径返回稳定语义去掉伪-id-冲突
- Team: DMA
- State: Backlog (backlog)
- Priority: High
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:44:40.309Z

## 问题

**位置**：`apps/web/app/api/sources/route.ts:32`、`api/sources/[id]/route.ts:17,30`、`api/scoring-config/route.ts:36`

mock 写路径返回 `{ id: mockSources.length + 1, ...parsed.data }`：

* `mockSources.length` 是进程内常量，并发 POST 都拿到同一 id
* UI mutation 缓存里塞进假 id，重载后再 DELETE 会 404
* 同理 `PUT /api/scoring-config` 仅 echo body 不落盘，next read 拿到旧数据

## 修复方案（择一）

A. **只读 mock**：所有写路径在 mock 模式下返回 `503 { error: "MOCK_READONLY" }`，UI 提示「演示模式不可写」
B. **进程内 store**：以一份 module-level `Map<string, T>` 持久化 mock 写入，加 `crypto.randomUUID()` 作 id

推荐 A，简单且不会误导真实流程。

## 验收

- [ ] mock 模式下，POST/PUT/DELETE 返回一致的 readonly 错误（或 store 写入正确）
- [ ] UI 在错误时给出明确提示，不污染 query cache
- [ ] 不再出现并发 id 冲突测试用例

### DMA-48 — [REVIEW-M2] worker 启动入口判定改用独立 bin

- URL: https://linear.app/dmarkubex/issue/DMA-48/review-m2-worker-启动入口判定改用独立-bin
- Team: DMA
- State: Backlog (backlog)
- Priority: High
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:44:35.133Z

## 问题

**位置**：`apps/worker/src/index.ts:11`

当前用 `process.argv[1]?.endsWith("worker/src/index.ts") || endsWith("worker/dist/index.js")` 判定是否启动。

风险：

* Docker `CMD ["node","/app/dist/index.js"]`、pm2、符号链接路径下不可靠
* 把模块导出与启动副作用混在同一文件，任何 `import { ... } from "./index"` 都会跑一次 `import("./runner")` 检查

## 修复

* 新建 `apps/worker/src/main.ts`（或 `bin/worker.ts`）作为唯一入口，调用 `startWorker()`
* `index.ts` 退化为纯 re-export，不带副作用
* 更新 `package.json` `bin` / Dockerfile CMD

## 验收

- [ ] `node apps/worker/dist/main.js` 启动正常
- [ ] 在 web 端 `import` worker 任何导出，不再触发启动逻辑
- [ ] Dockerfile 入口改成新文件
- [ ] 加 ESLint `no-restricted-imports` 禁止 `apps/web/**` 引用 `apps/worker/**`

### DMA-47 — [REVIEW-M1] health.ts 恢复 pgvector extension probe

- URL: https://linear.app/dmarkubex/issue/DMA-47/review-m1-healthts-恢复-pgvector-extension-probe
- Team: DMA
- State: Backlog (backlog)
- Priority: High
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:44:27.207Z

## 问题

**位置**：`packages/db/src/health.ts:22`

工作树改动把 `CREATE EXTENSION IF NOT EXISTS vector` 删了，只剩 `SELECT 1`。

风险：pgvector 未启用时，启动 health check 通过，但 embedder/cluster 在运行时才会爆。

## 修复方案（二选一）

A. 把 `CREATE EXTENSION` 显式写到 migration（`packages/db/migrations/000X_pgvector.sql`），permission 不够时启动失败
B. 在 `health.ts` 保留独立 probe：`SELECT 1 FROM pg_extension WHERE extname='vector'`，缺失则 health check 返回 unhealthy

## 验收

- [ ] 在缺 vector 扩展的 Postgres 上启动 → 启动期就明确失败（而不是运行时）
- [ ] 在已有 vector 扩展的 Postgres 上 → 通过
- [ ] 单测覆盖两种情况

### DMA-46 — [REVIEW-C1+C2] 闭合 mock-mode 安全漏洞（auth 绕过 + 客户端 flag 泄露）

- URL: https://linear.app/dmarkubex/issue/DMA-46/review-c1c2-闭合-mock-mode-安全漏洞auth-绕过-客户端-flag-泄露
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T02:47:04.964Z

## 背景

工作树 code review（2026-05-13）发现 mock-mode 实现存在 2 个 Critical 漏洞，**违反硬约束**，阻塞合并。

## 问题

### C1. Auth 绕过 + bcrypt 违规

**位置**：`apps/web/lib/auth/users.ts:17-26`

`findUserByUsername` 在 `isMockMode()` 时返回合成 admin（`admin/admin123456`），并用 `bcrypt.hash(_, 4)`。

* 违反 CLAUDE.md 硬约束：bcrypt(work_factor=12)
* 若 mock flag 误开到 prod，匿名即可登入 admin

### C2. 服务端 flag 经 `NEXT_PUBLIC_*` 泄露到客户端

**位置**：`apps/web/lib/mock-mode.ts:2`

`isMockMode()` 接受 `NEXT_PUBLIC_APP_DATA_MODE`。`NEXT_PUBLIC_*` 会被 Next.js 注入到客户端 bundle，任何用户在浏览器 DevTools 都可读到。该 flag 在 `api/sources/route.ts`、`api/scoring-config/route.ts`、`api/daily/route.ts`、`lib/auth/users.ts` 等位置被用来 gate **服务端写路径与 auth** —— 权限提升脚枪。

## 验收（Definition of Done）

- [ ] `isMockMode()` 只读 `APP_DATA_MODE`（去掉 `NEXT_PUBLIC_*` 来源）
- [ ] mock 分支即使开启，bcrypt cost 仍为 12（统一走 `BCRYPT_WORK_FACTOR=12`）
- [ ] 启动断言：`if (process.env.NODE_ENV === "production" && isMockMode()) throw new Error(...)`
- [ ] mock 用户路径只在 `NODE_ENV !== "production"` 时生效
- [ ] `grep -r "NEXT_PUBLIC_APP_DATA_MODE" apps packages` 返回 0
- [ ] `pnpm -r typecheck/lint/test/build` 全绿
- [ ] 测试覆盖：mock 关闭时 admin 合成账号不可登录

## Rollback

revert 本 issue 对应 commit；mock-mode 功能本身可后续通过 server-only flag 重新启用。

### DMA-34 — [Follow-up] T-M1-08 admin UI Playwright E2E + CI（DMA-29 acceptance gate 7 补缺）

- URL: https://linear.app/dmarkubex/issue/DMA-34/follow-up-t-m1-08-admin-ui-playwright-e2e-cidma-29-acceptance-gate-7
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T06:55:27.825Z

## 任务

补全 [DMA-29](<https://linear.app/dmarkubex/issue/DMA-29>) M1 抓取层未交付的 **acceptance gate 7 = T-M1-08 admin UI Playwright E2E**。

## 背景：缺什么

[DMA-29](https://linear.app/dmarkubex/issue/DMA-29/codex-execute-m1-抓取层10-tasks-含-t-m1-10-代理池) 评审发现：

* ❌ **测试代码根本没写**：`apps/web` 只有 3 个单测文件（`sources-schema.test.ts` / `password.test.ts` / `rbac.test.ts`），**无 admin sources E2E 测试**
* ❌ `@playwright/test` 没装在 apps/web；`playwright` 包只在 apps/worker（给 fetcher 用，不是给 UI E2E）
* ❌ 本地环境也跑不起来（Docker daemon 没启 + psql 没装）

Codex 自报 `review_pending` 没标 Done，回报诚实但 gate 7 真的没过。

本 issue **专门补这一项**，通过后才能解锁 [DMA-30](<https://linear.app/dmarkubex/issue/DMA-30>) M2。

## 任务范围（仅本 issue）

### 1\. 在 apps/web 装 Playwright E2E 工具链

* 加 devDep：`@playwright/test`
* 加 `apps/web/playwright.config.ts`（baseURL=`http://localhost:3000` · projects=chromium · webServer=`pnpm --filter @fe-radar/web start`）
* 加 `apps/web/e2e/` 目录（与 `__tests__/` 区分；vitest 不扫，playwright 扫）
* 加 `apps/web/package.json` script：`"e2e": "playwright test"`

### 2\. 写 admin sources login → CRUD E2E

新增文件 `apps/web/e2e/admin-sources.spec.ts`，覆盖：

1. 未登录访问 `/admin/sources` → 重定向 `/auth/login`
2. 用 admin 账号登录（用 seed 的 admin 用户 · bcrypt(12) hash）→ 跳回 `/adm

### DMA-33 — Codex Execute M5: 后台 / 监控 / 上线（8 tasks）

- URL: https://linear.app/dmarkubex/issue/DMA-33/codex-execute-m5-后台-监控-上线8-tasks
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-13T00:45:07.409Z

## 任务

实施 FE-Radar **M5 · 后台 / 监控 / 上线**（spec/tasks.md §7）。**最终 milestone**，完成后 release v1.0.0。

**前置**：M4 告警 / 日报 / 钉钉 SSO（独立 issue）必须 ✅ 才能开 M5。

**目标日期**：2026-06-30

## Task 清单（8 个 · 详见 [spec/tasks.md](<spec/tasks.md>) §7）

| ID | owner | scope |
| -- | -- | -- |
| T-M5-01 | agent-web-ui | /admin/dashboard（fetch 成功率 / 评分覆盖 / **priority backlog 行 ·** [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) **E3** / 代理池 disabled 列表 + re-enable · [DMA-24](https://linear.app/dmarkubex/issue/DMA-24/antigravity-复审-plan-v07-tasksmd-v02dma-23-fix-验证) B3） |
| T-M5-02 | agent-web-ui | /admin/scoring 评分配置（D 权重 / 阈值矩阵 · 后台编辑 + audit） |
| T-M5-03 | agent-web-ui | /admin/users 用户管理（角色 / **disabled_at 软删** · [DMA-26](https://linear.app/dmarkubex/issue/DMA-26/antigravity-第三轮复审-plan-v08-tasksmd-v03mobile-hash-disabled-at-detail) R2 / merge_conflicts confirm UI） |
| T-M5-04 | agent-web-ui | /admin/entities 实体词典（C1/C2/C3 + 别名 · CRUD） |
| T-M5-05 | agent-worker | cleanup job（90 天数据 · FK 级联 · testcontainers 集成测试） |
| T-M5-06 | agent-infra | Pino 日志 + OTEL trace + Grafana dashboard（priority backlog 老化告警） |
| T-M5-07 | agent-infra | MinIO 备份脚本（每日 PG dump + 7 日保留） |
| T-M5-08 | agent-infra | 上线 r

### DMA-32 — Codex Execute M4: 告警 / 日报 / 钉钉 SSO（9 tasks · 含 T-M4-05a 合并）

- URL: https://linear.app/dmarkubex/issue/DMA-32/codex-execute-m4-告警-日报-钉钉-sso9-tasks-含-t-m4-05a-合并
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T05:49:31.449Z

## 任务

实施 FE-Radar **M4 · 告警 / 日报 / 钉钉 SSO（含合并）**（spec/tasks.md §6）。

**前置**：M3 前端核心页面（独立 issue）必须 ✅ 才能开 M4。

**目标日期**：2026-06-27

## Task 清单（9 个 · 详见 [spec/tasks.md](<spec/tasks.md>) §6）

| ID | owner | scope |
| -- | -- | -- |
| T-M4-01 | agent-core | alert 计算（packages/core/alert.ts:computeAlert 单一入口） |
| T-M4-02 | agent-worker | alert 派发（多通道 alert_type · in-app + 钉钉机器人） |
| T-M4-03 | agent-worker | 日报生成（Kimi · 200K 上下文 · scrubber 前置） |
| T-M4-04 | agent-web-ui | /daily 日报页 |
| T-M4-05 | agent-auth | 钉钉 OAuth provider（Auth.js · 仅 unionid + name + dept · 不拉手机号） |
| T-M4-05a | agent-auth | **mergeOrCreateUser 合并策略**（[DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) R2 fix · 决策树 · merge_conflicts） |
| T-M4-06 | agent-web-ui | /alerts 告警页（type 筛选 · 已读/未读） |
| T-M4-07 | agent-web-ui | 用户偏好设置页（关注圈勾选 · alert_type 订阅） |
| T-M4-08 | agent-auth | RBAC 角色升级（admin 后台分配 role） |

## 执行顺序（依赖图 §8）

```
M3 完毕后开 · 三流并行：
  告警:   T-M4-01 → T-M4-02 / T-M4-06
  日报:   T-M4-03 → T-M4-04
  合并:   T-M4-05a (合并策略) → T-M4-05 (钉钉 provider · 调 mergeOrCreateUser)
                              → T-M4-08 (RBAC)
T-M4-07 偏好页：依赖 T-M4-01 + T-M4-05
```

⚠️ **T-M4-05 必须等 T-M4-05a 完成**（先有合并策略才能调 mergeOrCre

### DMA-31 — Codex Execute M3: 前端核心页面（8 tasks）

- URL: https://linear.app/dmarkubex/issue/DMA-31/codex-execute-m3-前端核心页面8-tasks
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T05:30:08.466Z

## 任务

实施 FE-Radar **M3 · 前端核心页面**（spec/tasks.md §5）。

**前置**：M2 Pipeline 与评分（独立 issue）必须 ✅ 才能开 M3（curator 输出是 timeline 数据源）。

**目标日期**：2026-06-22

## Task 清单（8 个 · 详见 [spec/tasks.md](<spec/tasks.md>) §5）

| ID | owner | scope |
| -- | -- | -- |
| T-M3-01 | agent-web-api | timeline GET API（分页 / 关注圈过滤 / 排除 block） |
| T-M3-02 | agent-web-ui | timeline 页（瀑布流 + 关注圈 Tab） |
| T-M3-03 | agent-web-api | curated GET API（精选 Tab · 排除 block） |
| T-M3-04 | agent-web-ui | curated 页（5 类标签筛选） |
| T-M3-05 | agent-web-api | item detail GET API（**block / pending / dropped 排除** · [DMA-26](https://linear.app/dmarkubex/issue/DMA-26/antigravity-第三轮复审-plan-v08-tasksmd-v03mobile-hash-disabled-at-detail) E1 fix） |
| T-M3-06 | agent-web-ui | item detail 页（评分卡片 + entity tags + summary + 原文跳转） |
| T-M3-07 | agent-web-ui | 全局 layout + 顶部导航 + Badge（告警未读数） |
| T-M3-08 | agent-web-ui | feedback 弹窗（👍/👎 + 文字反馈） |

## 执行顺序（依赖图 §8）

```
M2 完毕后开
T-M3-01 → T-M3-02 (timeline)
T-M3-03 → T-M3-04 (curated)  [并行]
T-M3-05 → T-M3-06 (detail)   [并行]
T-M3-07 (layout) [并行]
T-M3-08 (feedback) 依赖 T-M3-06
```

## 强制约束（同 [DMA-28](<https://linear.app/dmarkubex/issue/DMA-28>)）

1. 可写根 = `/Volumes/Out-Memory/AI-Timeline-web`
2. 每 task `

### DMA-30 — Codex Execute M2: Pipeline 与评分（15 tasks · 含 T-M2-14/15 scrubber）

- URL: https://linear.app/dmarkubex/issue/DMA-30/codex-execute-m2-pipeline-与评分15-tasks-含-t-m2-1415-scrubber
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T02:50:19.328Z

## 任务

实施 FE-Radar **M2 · Pipeline 与评分**（spec/tasks.md §4）。

**前置**：M1 抓取层（独立 issue · 见 relatedTo）必须 ✅ 才能开 M2。

**目标日期**：2026-06-14

## Task 清单（15 个 · 详见 [spec/tasks.md](<spec/tasks.md>) §4）

| ID | owner | scope |
| -- | -- | -- |
| T-M2-01 | agent-llm | packages/llm 共享 SDK 接口 |
| T-M2-02 | agent-llm | Qwen client（本地 27B） |
| T-M2-03 | agent-llm | DeepSeek client（5 维评分/摘要/翻译） |
| T-M2-04 | agent-llm | Kimi client（200K · 日报） |
| T-M2-05 | agent-worker | BullMQ 流水线骨架（7 queues + FlowProducer） |
| T-M2-06 | agent-worker | prefilter job（is_industry_related） |
| T-M2-07 | agent-worker | NER job + entities 词典加载（7 类） |
| T-M2-08 | agent-worker | scorer job（D1/D3/D4/D5 + summary/translation/category） |
| T-M2-09 | agent-worker | embedder + 向量索引（HNSW vs ivfflat benchmark · [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) E1） |
| T-M2-10 | agent-worker | cluster job（Redis 分布式锁 · [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) E2） |
| T-M2-11 | agent-core | scoring 纯函数（D2_chain 代码计算 + 加权聚合） |
| T-M2-12 | agent-core | quota Lua 脚本（双计数器 + 陈旧度监控 · [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) E3） |
| T-M2-13 | agent-worker | 评分回测脚本 + 100 条人工样本 |
|

### DMA-29 — Codex Execute M1: 抓取层（10 tasks · 含 T-M1-10 代理池）

- URL: https://linear.app/dmarkubex/issue/DMA-29/codex-execute-m1-抓取层10-tasks-含-t-m1-10-代理池
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T05:29:40.098Z

## 任务

实施 FE-Radar **M1 · 抓取层**（spec/tasks.md §3）。

**前置**：[DMA-28](<https://linear.app/dmarkubex/issue/DMA-28>) M0 已 ✅ APPROVED（13 acceptance gates 全过 / 16 个 \[T-M0-XX\] commits 落真仓库 / pnpm install + typecheck + lint + test + madge 全绿）。

**目标日期**：2026-05-31

## Task 清单（10 个 · 详见 [spec/tasks.md](<spec/tasks.md>) §3）

| ID | owner | scope |
| -- | -- | -- |
| T-M1-01 | agent-db | sources schema 扩展 + Drizzle ORM |
| T-M1-02 | agent-worker | RSS fetcher |
| T-M1-03 | agent-worker | HTML fetcher (cheerio) |
| T-M1-04 | agent-worker | Playwright fetcher |
| T-M1-05 | agent-worker | 调度器（cron 6h + retry + 7d disable） |
| T-M1-06 | agent-worker | 去重逻辑 |
| T-M1-07 | agent-web-api | 信源 admin API（CRUD） |
| T-M1-08 | agent-web-ui | 信源后台页 /admin/sources |
| T-M1-09 | agent-db | 信源 v1 seed（37 条 · [DMA-14](https://linear.app/dmarkubex/issue/DMA-14/q-c-提供-t1-t2-t3-信源-rss-url-清单) 候选） |
| T-M1-10 | agent-worker | **代理池 + UA 轮换**（[DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) R3 fix · M1 入口前置） |

## 执行顺序（依赖图 §8）

```
T-M1-01 (sources schema)
  └─ T-M1-10 (代理池前置)
       └─ T-M1-02..04 (并行 3 fetcher)
            └─ T-M1-05 / T-M1-06 / T-M1-07 (并行)
                 └─ T-M1-08 (admin 页)


### DMA-28 — [Re-execute] Codex M0 落地真仓库（DMA-25 REJECTED · 沙盒未同步 + CI gate 全失败）

- URL: https://linear.app/dmarkubex/issue/DMA-28/re-execute-codex-m0-落地真仓库dma-25-rejected-沙盒未同步-ci-gate-全失败
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T00:20:59.281Z

## 任务

[DMA-25](https://linear.app/dmarkubex/issue/DMA-25/codex-execute-fe-radar-m0m5-多-agent-实施v07v02-plan-approved) 第一轮 Codex Execute 被 Claude Code 评审 **REJECTED**。本 issue 是 corrective re-run，仅聚焦 M0；M0 全绿后再开新 issue 启 M1–M5。

## [DMA-25](https://linear.app/dmarkubex/issue/DMA-25/codex-execute-fe-radar-m0m5-多-agent-实施v07v02-plan-approved) 失败根因（必读）

| \# | 失败项 | 根因 |
| -- | -- | -- |
| C1 | M0 代码未落到真仓库 | Codex 在沙盒 `/Volumes/Out-Memory/code_projects/workspaces/DMA-25` 里写完，未 propagate 回 `/Volumes/Out-Memory/AI-Timeline-web` |
| C2 | 0 个 CI gate 通过 | `pnpm install` DNS 失败（`registry.npmmirror.com` 不可达）→ `node_modules` 缺失 → lint/typecheck/test/build/madge 全部 command not found |
| C3 | Issue 状态机错误关闭 | Codex 自报 `partial`，issue 却被标 `Done` |
| M1 | spec/handoff 沙盒分叉 | Codex 在沙盒里"修订" tasks.md / handoff.md，真仓库未更新，制造未来合并冲突 |

详细评审见 [DMA-25](https://linear.app/dmarkubex/issue/DMA-25/codex-execute-fe-radar-m0m5-多-agent-实施v07v02-plan-approved) 最后一条评论。

## 强制约束（违反即拒收）

### 1\. 可写根 = 真仓库

* **唯一可写根** = `/Volumes/Out-Memory/AI-Timeline-web`
* 禁止再用 `/Volumes/Out-Memory/code_projects/workspaces/*` 沙盒策略；如沙箱限制无法解除，必须 STOP 并在评论里求助，**不得绕过**
* 所有交付物必须以 `git commit` 形式落到真仓库 master（或 PR feature 分支）

### 2\. 依

### DMA-27 — Antigravity 第三轮复审 Plan v0.8 + tasks.md v0.3（mobile_hash / disabled_at / detail PII fix 验证）

- URL: https://linear.app/dmarkubex/issue/DMA-27/antigravity-第三轮复审-plan-v08-tasksmd-v03mobile-hash-disabled-at-detail
- Team: DMA
- State: Duplicate (canceled)
- Priority: Urgent
- Assignee: 
- Labels: antigravity
- Updated: 2026-05-08T15:41:15.524Z

## 任务

对 `spec/requirements.md` v0.8 + `spec/design.md` v0.8 + `spec/tasks.md` v0.3 + `handoff.md` 进行第三轮 Stage 4 Audit，验证上一轮 Antigravity 提的 2 Systemic + 1 Edge 是否已闭合。

## 背景

* [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) → v0.7 / v0.2（3 Critical + 3 Edge closed）
* [DMA-24](https://linear.app/dmarkubex/issue/DMA-24/antigravity-复审-plan-v07-tasksmd-v02dma-23-fix-验证) → APPROVED（4 Minor 内化）
* 第二轮 Antigravity audit (out-of-band) verdict `REJECTED`：
  * **R1 · Account Merging Deadlock**：design §10c step 2 用 mobileHash 自动合并，但 requirements §10.2 明说"不拉手机号"——路径永不命中
  * **R2 · Missing Disable State**：T-M5-03 提"停用"功能，但 users schema 无 `disabled_at` / `is_enabled`
  * **E1 · Detail API PII Leak**：T-M3-05 详情 API 未排除 block 状态 item，可被 ID 枚举越权访问
* Claude Code Plan Stage Fix Plan 已落地到 v0.8 / v0.3

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.8
* `spec/design.md` v0.8
* `spec/tasks.md` v0.3
* `handoff.md`

## A. 三项 fix 验证

### A1 (R1 · Merging Deadlock)

* `design.md §8 users` 表 ❌ **不再含** `mobile_hash` 字段；索引 `users_mobile_hash_idx` 已撤
* `design.md §10c mergeOrCreateUser({ unionid, name, dept })` 函数签名 **不含** mobileHash 参数
* §10c 决策树 = 3 步：
  1.

### DMA-25 — Codex Execute: FE-Radar M0→M5 多 agent 实施（v0.7/v0.2 Plan APPROVED）

- URL: https://linear.app/dmarkubex/issue/DMA-25/codex-execute-fe-radar-m0m5-多-agent-实施v07v02-plan-approved
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-11T01:15:06.191Z

## 任务

按 `spec/tasks.md` v0.2 的 60 task / 8 sub-agent 分工，从 M0 → M5 全程实施 FE-Radar 项目。**调用 Codex 多 agent 并行能力**，按 §8 跨 milestone 依赖图最大化并行度。

## 上下文（必读，按顺序）

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

1. `CLAUDE.md` — 项目章节含技术栈 / monorepo 结构 / 8 sub-agent 表 / **13 条硬约束** / **8 条陷阱** / Linear 约定
2. `AI_index.md` — kernel 规则
3. `.ai/shared/agreements.md` — 跨项目执行约定
4. `.ai/shared/style-invariants.md` v1.0 — **17 节代码规范**（写代码前必读，违例 = code review major）
5. `.ai/shared/task-template.md` — 每个 task 字段约定
6. `spec/requirements.md` v0.7 — WHAT
7. `spec/design.md` v0.7 — HOW
8. `spec/tasks.md` v0.2 — 60 task 清单（**主战场**）
9. `handoff.md` — 当前控制状态（Stage = Execute / Owner = Codex）

## Plan 已通过

* [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) → [DMA-21](https://linear.app/dmarkubex/issue/DMA-21/第四轮复评-plan-v06dma-20-fix-plan-验证-最终关卡)（Symphony 4 轮 fix + 1 轮 pass）
* [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) → [DMA-24](https://linear.app/dmarkubex/issue/DMA-24/antigravity-复审-plan-v07-tasksmd-v02dma-23-fix-验证)（Antigravity Stage 4 Audit · **APPROVED**）
* §13 决策 Q-A…Q-K 全 closed（[DMA-7](https://linear.app/dmarkubex/issue/DMA-7/q-b-补充-c1-c2-关注圈名单)…[DMA-16](https://linear.app/

### DMA-24 — Antigravity 复审 Plan v0.7 + tasks.md v0.2（DMA-23 Fix 验证）

- URL: https://linear.app/dmarkubex/issue/DMA-24/antigravity-复审-plan-v07-tasksmd-v02dma-23-fix-验证
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: antigravity
- Updated: 2026-05-11T06:30:59.740Z

## 任务

对 `spec/requirements.md` v0.7 + `spec/design.md` v0.7 + `spec/tasks.md` v0.2 + `handoff.md` 进行第二轮 Stage 4 Audit，验证 [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) 提的 3 Critical + 3 Edge 是否已闭合；这是进入 Codex Execute (M0) 之前的最终关卡。

## 背景

* [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) (v0.1 → v0.2) verdict `REJECTED`：3 Critical（外部 LLM 泄密 / 账号合并 / 爬虫抗封锁）+ 3 Edge（HNSW vs ivfflat / cluster 竞态 / priority 饥饿）
* Claude Code Plan Stage Fix Plan 已落地到 spec v0.7 + tasks.md v0.2
* 60 task 分布：M0=10 / M1=10 (+1 R3) / M2=15 (+2 R1) / M3=8 / M4=9 (+1 R2) / M5=8

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.7
* `spec/design.md` v0.7
* `spec/tasks.md` v0.2
* `handoff.md`

## A. [DMA-23](https://linear.app/dmarkubex/issue/DMA-23/对task任务进行评审) Fix 6 项验证

### A1 (R1 · 外部 LLM 泄密) Critical

应在以下位置看到 scrubber 强制中间件：

* `tasks.md` 新增 T-M2-14（scrubber 模块）+ T-M2-15（LLM 链集成）
* `tasks.md` T-M2-06 / T-M2-08 / T-M4-03 constraint 含 "调 LLM 前必经 T-M2-14 scrubber"
* `design.md §5.x` 完整 scrubber 阶段（block / safe / redacted 三状态 + audit log）
* `requirements.md §12` "公网 LLM 调用前强制脱敏" 条款
* 验证：`grep -n scrubber spec/*.md` 应有多处一致引用

### A2 (R2 · 账号合并)

### DMA-21 — 第四轮复评 Plan v0.6（DMA-20 Fix Plan 验证 · 最终关卡）

- URL: https://linear.app/dmarkubex/issue/DMA-21/第四轮复评-plan-v06dma-20-fix-plan-验证-最终关卡
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-08T13:25:32.451Z

## 任务

对 `spec/requirements.md` v0.6 + `spec/design.md` v0.6 + `handoff.md` 进行第四轮复评，验证 [DMA-20](https://linear.app/dmarkubex/issue/DMA-20/复复复评-plan-v05dma-19-fix-plan-验证-最终关卡) 提的 2 Major + 1 Minor 是否已闭合。**这是进入 tasks.md 产出 + Antigravity Plan Review 之前的最终关卡**。

## 背景

* [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) (v0.1→v0.2) closed
* [DMA-18](https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证) (v0.3→v0.4) closed
* [DMA-19](https://linear.app/dmarkubex/issue/DMA-19/复复评-plan-v04dma-18-fix-plan-验证) (v0.4→v0.5) closed
* [DMA-20](https://linear.app/dmarkubex/issue/DMA-20/复复复评-plan-v05dma-19-fix-plan-验证-最终关卡) (v0.5→v0.6) verdict `request changes`（handoff stale + spec open-question 措辞 + admin backlog drill-down 缺）→ Claude Code Fix Plan 落地到 v0.6
* §13 决策 Q-A…Q-K 全部 closed

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.6
* `spec/design.md` v0.6
* `handoff.md`

## A. [DMA-20](https://linear.app/dmarkubex/issue/DMA-20/复复复评-plan-v05dma-19-fix-plan-验证-最终关卡) Fix Plan 3 项验证

### A1 (F1) · handoff.md 全部刷新到 v0.6

* §1 State 行说 v0.6 + 四轮复评全 closed
* §5 Completed 包含 v0.5 / v0.6 / [DMA-19](https://linear.app/dmarkubex/i

### DMA-20 — 复复复评 Plan v0.5（DMA-19 Fix Plan 验证 + 最终关卡）

- URL: https://linear.app/dmarkubex/issue/DMA-20/复复复评-plan-v05dma-19-fix-plan-验证-最终关卡
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-08T08:07:21.541Z

## 任务

对 `spec/requirements.md` v0.5 + `spec/design.md` v0.5 + `handoff.md` 进行**复复复评**，验证 [DMA-19](https://linear.app/dmarkubex/issue/DMA-19/复复评-plan-v04dma-18-fix-plan-验证) Symphony 复复评的 4 Major + 1 Minor 是否已正确闭合。**这是进入 tasks.md 产出 + Antigravity Plan Review 之前的最后自动化关卡**。

## 背景

* [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) (v0.1 → v0.2)：3 Major closed
* [DMA-18](https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证) (v0.3 → v0.4)：6 Major + 2 Minor closed
* [DMA-19](https://linear.app/dmarkubex/issue/DMA-19/复复评-plan-v04dma-18-fix-plan-验证) (v0.4 → v0.5)：4 Major + 1 Minor verdict `request changes`，Claude Code Fix Plan 落地到 v0.5
* §13 开放问题 Q-A…Q-K 全部 closed

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.5
* `spec/design.md` v0.5
* `handoff.md`

## A. [DMA-19](https://linear.app/dmarkubex/issue/DMA-19/复复评-plan-v04dma-18-fix-plan-验证) Fix Plan 5 项验证

### A1 (F1) · feedbacks FK CASCADE

* `design.md §8` `feedbacks.item_id` 应含 `ON DELETE CASCADE`
* cleanup 4 步事务在 step 1 删 items 时不再被 feedbacks 阻塞
* 验证：`grep -n "feedbacks" spec/design.md` 看到 cascade 子句

### A2 (F2) · 双计数器 Lua 原子化

* `design.md §5.1` 应有 Lua 脚本（`A

### DMA-19 — 复复评 Plan v0.4（DMA-18 Fix Plan 验证）

- URL: https://linear.app/dmarkubex/issue/DMA-19/复复评-plan-v04dma-18-fix-plan-验证
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-08T08:07:21.541Z

## 任务

对 `spec/requirements.md` v0.4 + `spec/design.md` v0.4 + `handoff.md` 进行**复复评**，验证 [DMA-18](https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证) Symphony 复评的 6 Major + 2 Minor 是否已正确闭合。

## 背景

* [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) (v0.1 → v0.2)：3 Major 已 closed
* [DMA-18](https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证) (v0.3 → v0.4)：6 Major + 2 Minor verdict `request changes`，Claude Code Fix Plan 落地到 v0.4
* 所有 §13 开放问题（Q-A…Q-K）已 closed（[DMA-7](https://linear.app/dmarkubex/issue/DMA-7/q-b-补充-c1-c2-关注圈名单)…[DMA-16](https://linear.app/dmarkubex/issue/DMA-16/q-k-nfr-01-中1500-条是单轮峰值还是单日上限) 全部 Done；信源清单按候选 v1 全采用）
* 本 issue 是进入 tasks.md 产出 + Antigravity Plan Review 之前的最后自动化关卡

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.4
* `spec/design.md` v0.4
* `handoff.md`

## A. [DMA-18](https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证) Fix Plan 8 项验证

### A1 (F1) · scoring_config 默认 seed

应在 `design.md §8` `scoring_config` 表后看到 `INSERT INTO scoring_config ...` 块，覆盖 weights / thresholds / t_coef / c_coef，**值与 requirements §7.2 / §7.3 默认值

### DMA-18 — 复评 Plan v0.3（Q-D…Q-K 决策内化 + Symphony fix 验证）

- URL: https://linear.app/dmarkubex/issue/DMA-18/复评-plan-v03q-dq-k-决策内化-symphony-fix-验证
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-08T08:07:21.541Z

## 任务

对 `spec/requirements.md` v0.3 + `spec/design.md` v0.3 + `handoff.md` 进行**完整复评**。

## 背景

* v0.1 → v0.2：Claude Code 修了 Symphony [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) 提的 3 条 Major（流程顺序 / 1500 吞吐歧义 / 快照-保留-隐私冲突）
* v0.2 → v0.3：用户回复 [DMA-7](https://linear.app/dmarkubex/issue/DMA-7/q-b-补充-c1-c2-关注圈名单)…[DMA-16](https://linear.app/dmarkubex/issue/DMA-16/q-k-nfr-01-中1500-条是单轮峰值还是单日上限)（Q-B…Q-K）后，Claude Code 把 8 条决策内化进 spec，并新增了 alert_type 多通道、本地账号登录、限速器、90 天 cleanup job
* [DMA-17](https://linear.app/dmarkubex/issue/DMA-17/复评-plan-v02symphony-dma-6-fix-验证)（v0.2 复评任务）实际未被自动化触发，本 issue 取代它对**现行 v0.3** 做完整复评

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

文件：

* `spec/requirements.md` v0.3
* `spec/design.md` v0.3
* `handoff.md`

## A. Symphony [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) 3 条 Major（继续验证是否仍闭合）

### A1 · Plan/Tasks 顺序

应在三处一致呈现：`Human Review → 解决开放问题 → 产出 tasks.md → Antigravity Plan Review → Fix Plan → Execute`

* `requirements.md` 顶部审阅流程行 + 文末后续动作段
* `design.md §18`
* `handoff.md §3 Queue`

### A2 · 吞吐定义

应锁定为"**日上限 ≤1500 条**"：

* `requirements.md NFR-01` 文字
* `requirements.md §13 Q-K` 状态 = ✅ A
* `design.md §5.1` 单一成本表（删除场景 B），含限速器实

### DMA-17 — 复评 Plan v0.2（Symphony DMA-6 fix 验证）

- URL: https://linear.app/dmarkubex/issue/DMA-17/复评-plan-v02symphony-dma-6-fix-验证
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: codex
- Updated: 2026-05-08T06:55:40.357Z

## 任务

对 `spec/requirements.md` v0.2 + `spec/design.md` v0.2 + `handoff.md` 进行**复评**，验证 Symphony 在 [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) 提出的 3 条 Major 是否已正确闭合。

## 评审范围

仓库根：`/Volumes/Out-Memory/AI-Timeline-web`

需对照 [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) 评论中的 3 条 Major 逐条确认：

### Finding 1 · Plan/Tasks 顺序

**v0.1 问题**：tasks.md 排在 Antigravity Plan Review 之后，违反 `AI_index.md:127-133, 169` 与 `.ai/shared/review-protocol.md §1.Gate1`。
**v0.2 fix 应在**：

* `spec/requirements.md` 文末 §14 后的"下一步动作"段
* `spec/design.md §18` 表格
* `handoff.md §3 Queue`

→ 验证：三处顺序是否一致 = "Human Review → 解决开放问题 → 产出 tasks.md → Antigravity Plan Review → Fix Plan → Execute"

### Finding 2 · 1500 条/轮 vs 1500 条/天

**v0.1 问题**：NFR-01 说"单轮 ≤1500"，design §5.1 按"1500/天"算成本，含义不一致。
**v0.2 fix 应在**：

* `requirements.md` NFR-01 改为参数化（待 Q-K）
* `requirements.md` §13 新增 Q-K 开放问题
* `design.md §5.1` 成本表改为两场景（A 1500/天、B 1500/轮）

→ 验证：是否消除了硬编码 ¥120/月，是否给出 NFR-05 风险标注。

### Finding 3 · 快照 / 保留 / 隐私三处冲突

**v0.1 问题**：

* "MVP 不抓快照" (FR-12) ↔ MinIO 存"原文 HTML/截图" + items.raw_html 列
* NFR-03 12 个月 ↔ §12 90 天
* §10.2 拉 mobile ↔ §12 仅存 unionid+name+dept

**v0.2 fix 应在**：

* `requirements.md` NFR-03 

### DMA-16 — [Q-K] NFR-01 中"1500 条"是单轮峰值还是单日上限？

- URL: https://linear.app/dmarkubex/issue/DMA-16/q-k-nfr-01-中1500-条是单轮峰值还是单日上限
- Team: DMA
- State: Done (completed)
- Priority: High
- Assignee: 
- Labels: 
- Updated: 2026-05-08T13:25:32.451Z

## 背景

Symphony [DMA-6](https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计) 评审发现 `spec/requirements.md` v0.1 与 `spec/design.md` v0.1 对吞吐量定义不一致：

* requirements.md NFR-01：`单轮抓取（≤1500 条）端到端处理 ≤30 分钟`
* requirements.md §1：`每 6 小时抓一遍`（即每天 4 轮）
* design.md §5.1（v0.1）：DeepSeek 月成本按 `1500 条/天` 计算，得 ¥120/月

如果 1500 是单轮峰值 → 实际日均 6000 条 → DeepSeek 月成本 ≈ ¥480/月，**超过 NFR-05 ≤500 元/月预算上限**，且 worker 并发、Postgres 写入压力同步翻 4 倍。

## 需要决策

请明确以下两选一：

* **A · 1500 是日上限**（实际 ≈ 375 条/轮 × 4 轮）
  * 月成本 ≈ ¥150（NFR-05 余量大）
  * worker 默认并发够用（3 replicas × 0.5 CPU）
  * 建议：保持现 NFR-01 文字不变，把"单轮"改为"日上限"
* **B · 1500 是单轮峰值**（日总量 6000）
  * 月成本 ≈ ¥510（**超 NFR-05 上限**）→ 需要二选一缓解：
    * B1：本地 Qwen3.6 接管 D1/D5 评分（D3/D4 留 DeepSeek），月成本回落到 ≈ ¥250
    * B2：上调 NFR-05 上限到 ¥800/月
  * worker 并发需扩容到 6 replicas，或缩短 SLA 到"单轮 ≤45 分钟"

## 影响

* requirements.md NFR-01 / NFR-05 表述
* design.md §5.1 LLM 成本表（v0.2 已改成参数化两列）
* design.md §12 资源估算（worker replicas / postgres 卷大小）
* 抓取 fetcher 并发上限设计

## 决策格式

评论里写："A" 或 "B1" 或 "B2"，附简短理由（如有）。

### DMA-15 — [Q-D] 评分权重 w1..w5 默认值确认

- URL: https://linear.app/dmarkubex/issue/DMA-15/q-d-评分权重-w1w5-默认值确认
- Team: DMA
- State: Done (completed)
- Priority: Medium
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:58:49.051Z

## 背景

`spec/requirements.md §7.2` 默认权重：

| 权重 | 维度 | 默认 |
| -- | -- | -- |
| w1 | D1 政策法规 | 0.20 |
| w2 | D2 产业链关联 | 0.25 |
| w3 | D3 市场/价格 | 0.20 |
| w4 | D4 技术/标准 | 0.15 |
| w5 | D5 商业机会/风险 | 0.20 |

## 是否接受默认值？

* ✅ 接受 → 写入 `scoring_config` 初始值
* ❌ 调整 → 提供新权重组（和必须为 1.00）

## 备注

权重存数据库，admin 可后台调整无需发版。回测时可再 A/B 调优。

### DMA-14 — [Q-C] 提供 T1 / T2 / T3 信源 RSS / URL 清单

- URL: https://linear.app/dmarkubex/issue/DMA-14/q-c-提供-t1-t2-t3-信源-rss-url-清单
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: 
- Updated: 2026-05-11T00:19:04.336Z

## 背景

`spec/requirements.md §6` 列了 T1 / T2 / T3 类型与示例，但实际 RSS / URL 清单缺失。M1 抓取层无信源即无法运行。

## 需要交付

每条信源至少含：

* `name`：站点名
* `tier`：T1 / T2 / T3
* `category`：政策 / 媒体 / 协会 / 公告 / 综合
* `fetcher_type`：rss / html / playwright
* `url`（rss）或 `listUrl + selectors`（html / playwright）

## 数量目标

* T1 ≥ 10（政府 + 协会 + 上市公司公告）
* T2 ≥ 15（专业媒体 + Wind 行业号）
* T3 ≥ 10（综合财经 + 自媒体 + 社交）
* 总计 ≥ 35，便于 M1 验收"30 信源 7 天成功率 ≥ 95%"

## 阻塞

* 阻塞 M1 全部验收
* 阻塞 M2 评分回测样本

## 决策格式

评论贴 CSV 或 Notion / 飞书表格链接。

### DMA-13 — [Q-J] 首批 admin 名单（钉钉账号）

- URL: https://linear.app/dmarkubex/issue/DMA-13/q-j-首批-admin-名单钉钉账号
- Team: DMA
- State: Done (completed)
- Priority: Medium
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:58:38.091Z

## 背景

钉钉 SSO 后所有用户默认 `viewer`，需要 admin 在后台手动升级。首批 admin 必须在数据库里预置（dingtalk_id 已知），否则没人能进后台。

## 需要提供

首批 admin（建议 2–3 人）的：

* 姓名
* 钉钉手机号或 unionid（unionid 可在 SSO 第一次登录后取，但首批要预置就需手机号映射）
* 部门

## 推荐

* 1 名战略口（高层代理）
* 1 名信息中心 / IT（运维）
* 1 名市场或品牌（业务侧）

## 决策格式

凭据/隐私走安全渠道；可在评论 ack 已私下提供。

### DMA-12 — [Q-I] 数据保留期：12 个月是否合规要求

- URL: https://linear.app/dmarkubex/issue/DMA-12/q-i-数据保留期12-个月是否合规要求
- Team: DMA
- State: Done (completed)
- Priority: Medium
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:59:18.831Z

## 背景

`spec/requirements.md §12` 当前规则：

* 原始 HTML 保留 90 天
* Item 元数据保留 12 个月
* 分析结果（评分、摘要、实体）永久保留

## 需要确认

* 远东法务 / 信息安全部门对**第三方内容缓存**是否有更短的保留要求？
* 是否需要"应权利人要求即时删除"的接口（DMCA-like）？
* 用户反馈数据是否涉及个保法（含钉钉 unionid + name + dept）？保留多久？

## 影响

* 缩短 → 减小存储压力，但回测样本变小
* 加严删除接口 → 后台需多一个"按 url 删除 item + 关联表级联"功能

## 阻塞

* 阻塞 §12 数据保留实现细节
* 不阻塞 M0–M2 编码（先按当前规则实现，到 M5 验收前再调）

### DMA-11 — [Q-H] "安全事故"是否独立告警通道

- URL: https://linear.app/dmarkubex/issue/DMA-11/q-h-安全事故是否独立告警通道
- Team: DMA
- State: Done (completed)
- Priority: Medium
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:59:45.823Z

## 背景

当前告警仅针对"自家公司被提及"。行业内重大安全事故（火灾、爆炸、电网故障）对远东也是重要信号，但与"自家"独立。

## 选项

* **A 不独立**（默认）：靠 NER `event_type=事故` + D1/D5 高分进精选 Tab
* **B 独立通道**：新增 `/alerts/safety` 页 + 全局 Badge 第二个数字
* **C 复用现 alert_level + 标签**：在 `/alerts` 页加 type 筛选（自家 / 安全事故 / 政策突发）

## 推荐

C — 复用现页面，零新表，灵活扩展（未来还可加"政策突发""价格剧变"）。

## 决策需要

确认走 A / B / C 哪个。

### DMA-10 — [Q-G] "营销软文识别 / 反向扣分"是否纳入 MVP

- URL: https://linear.app/dmarkubex/issue/DMA-10/q-g-营销软文识别-反向扣分是否纳入-mvp
- Team: DMA
- State: Done (completed)
- Priority: Low
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:58:15.141Z

## 背景

T3 信源（自媒体、综合财经）易混入营销软文，可能污染精选与日报。

## 选项

* **A 不做**（建议，M5+ 再评估）：相信信源分级 + 阈值能压住大多数
* **B 新增 D6 维度**：让 LLM 输出"软文倾向"分（0–100），最终分公式扣减
* **C 黑名单关键词**：维护"软广特征词"列表，命中即扣 20

## 影响

* 选 A：MVP 不变
* 选 B：+ 1 LLM 调用 / 条 → 月成本 +约 ¥80
* 选 C：维护成本中等，假阳性高

## 推荐

A — 上线后跟踪 1 周精选投诉率，按需引入。

### DMA-9 — [Q-F] 钉钉应用 AppKey / 回调域名 / 内网部署域名

- URL: https://linear.app/dmarkubex/issue/DMA-9/q-f-钉钉应用-appkey-回调域名-内网部署域名
- Team: DMA
- State: Done (completed)
- Priority: Urgent
- Assignee: 
- Labels: 
- Updated: 2026-05-11T05:49:25.517Z

## 背景

`spec/requirements.md §10` 钉钉 SSO 接入沿用远东集团**现有的钉钉开放平台应用**（不新建）。

## 需要管理员提供

* `DINGTALK_APP_KEY`
* `DINGTALK_APP_SECRET`
* 企业 `CorpID`
* 内网部署域名（用于钉钉应用回调白名单），例 `feradar.fe.local`
* 当前钉钉应用是否已开启"扫码登录"能力；若否，需联系管理员开启

## 阻塞

* 阻塞 M4 SSO 验收
* 缓解方案：M0–M3 先用本地用户名/密码占位登录

## 决策格式

凭据走安全渠道（不要贴在评论里）。可在评论里 ack 已私下提供。

### DMA-8 — [Q-E] 各类精选阈值默认值确认

- URL: https://linear.app/dmarkubex/issue/DMA-8/q-e-各类精选阈值默认值确认
- Team: DMA
- State: Done (completed)
- Priority: Medium
- Assignee: 
- Labels: 
- Updated: 2026-05-08T05:59:32.094Z

## 背景

`spec/requirements.md §7.3` 阈值表（命中即进精选 Tab）：

| 大类 | C1 | C2 | C3 |
| -- | -- | -- | -- |
| 政策与标准 | 55 | 60 | 65 |
| 市场与价格 | 55 | 60 | 70 |
| 技术与产品 | 55 | 65 | 75 |
| 项目与招投标 | 50 | 60 | 70 |
| 公司与资本 | 55 | 65 | 75 |

## 是否接受默认值？

* ✅ 接受 → 写入 `scoring_config`
* ❌ 调整 → 提供新阈值矩阵

## 备注

阈值存数据库，可后台调整。建议上线后 1 周内根据精选 Tab 主观满意度回调。

### DMA-7 — [Q-B] 补充 C1 / C2 关注圈名单

- URL: https://linear.app/dmarkubex/issue/DMA-7/q-b-补充-c1-c2-关注圈名单
- Team: DMA
- State: Done (completed)
- Priority: High
- Assignee: 
- Labels: 
- Updated: 2026-05-08T13:25:32.451Z

## 背景

`spec/requirements.md §5` 的 C1 / C2 名单为初稿，需要补充完整后录入 `entities` 表（可后台编辑）。

## 需要确认

* C1 自家公司：远东控股集团 / 远东电缆 / 远东智慧能源 / 远东股份 — 是否还有别名或子公司需补
* C1 核心客户：国家电网（含 27 家省网）/ 南方电网 / 国家能源局 / 发改委 / 工信部 / 五大发电集团 — 是否完整
* C2 主要竞品（电缆）：宝胜、江南、中天、亨通、起帆、金杯 — 是否需要增补/删除
* C2 关键上游（铜杆 + 电芯）/ 关键下游（房企 + EPC + 储能集成商） — 名单是否合理
* 海外公司是否纳入 C2（如 Prysmian / Nexans / Sumitomo 等）

## 阻塞

* 阻塞 D2_chain 评分准确率
* 阻塞 §11 自家公司告警的命中范围

## 决策格式

请直接在评论里贴最终名单（按 C1 / C2 分组、含别名），或上传 CSV。

### DMA-6 — 评审项目需求及设计

- URL: https://linear.app/dmarkubex/issue/DMA-6/评审项目需求及设计
- Team: DMA
- State: Done (completed)
- Priority: No priority
- Assignee: 
- Labels: 
- Updated: 2026-05-08T13:25:32.451Z

针对claude给出的项目需求和设计进行评审，给出评审意见
