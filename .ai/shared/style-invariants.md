# FE-Radar Style Invariants

> Customized for FE-Radar (远东控股产业情报雷达) · Plan v0.6
> 技术栈：Next.js 15 / React 19 / TypeScript / Drizzle ORM / Postgres 16 + pgvector / BullMQ / Redis / Tailwind + shadcn-ui / Pino / Auth.js
> 详细技术决策见 `spec/design.md §2`

每个执行 agent **写代码前必读本文件**。代码评审中发现的违例默认 **major** 严重度。

---

## 1. 仓库结构（Monorepo）

```
/
├── apps/
│   ├── web/                 # Next.js 一体化（前端 + Route Handlers）
│   └── worker/              # 独立 Node 进程（BullMQ consumer）
└── packages/
    ├── db/                  # Drizzle schema + migration + client
    ├── llm/                 # Qwen / DeepSeek / Kimi 三家封装
    ├── core/                # 业务规则（评分、配额、告警、聚类）
    └── shared/              # 类型 / 错误类 / 常量 / dayjs 配置
```

**模块边界硬约束**：
- 跨 package import **必须**经其 `index.ts` 公共出口；不允许 deep import (`packages/x/internal/y`)
- `apps/web` 与 `apps/worker` **不互相 import**；共享逻辑下沉到 `packages/*`
- `packages/core` **不依赖** `packages/db`（业务规则纯函数化便于单测；DB 调用层在 apps/* 完成数据装配后传入）
- 禁止循环依赖（CI 用 `madge --circular` 检查）

---

## 2. 命名约定

| 类别 | 规则 | 例 |
|---|---|---|
| TS 源文件（非组件）| `kebab-case.ts` | `compute-alert.ts` |
| React 组件文件 | `PascalCase.tsx` | `TimelineCard.tsx` |
| React Hook 文件 | `use-*.ts` | `use-quota-status.ts` |
| 函数 / 方法 | `camelCase` | `admitToScoring()` |
| 常量 | `UPPER_SNAKE_CASE` | `DAILY_BUDGET_NORMAL` |
| Drizzle 表 / 列 | `snake_case` | `item_analysis.alert_type` |
| API 路径 | `kebab-case` | `/api/admin/backlog` |
| API JSON 字段 | `camelCase` | `{ alertType, qualityScore }` |
| Redis key | `snake_case` 分段 `:` | `scoring:counter:normal:2026-05-08` |
| BullMQ queue | `fe:<stage>` | `fe:scorer`, `fe:fetch` |
| Linear / commit | `[DMA-XX] 中文/英文皆可` | `[DMA-7] 补 C1 名单` |

---

## 3. TypeScript

- `strict: true` + `noUncheckedIndexedAccess: true`，禁用 `any`（必要时用 `unknown` + 收窄）
- 禁止 `// @ts-ignore`；要绕用 `// @ts-expect-error <reason>`，**必带原因**
- 公开 API（`packages/*/index.ts` 导出的）必须显式标注返回类型
- 优先 `type` 别名表达 union/intersection；类只在需要 OOP 时用（错误类继承）
- enum 用 union literal 替代（`'C1' | 'C2' | 'C3'`），不用 TS `enum`

---

## 4. 数据库 / Drizzle

- **禁止字符串拼 SQL**；所有查询经 Drizzle 参数化或 prepared statement
- migrations 路径 `packages/db/migrations/<NNNN>_<topic>.sql`，序号严格递增
- seed 分两类：
  - `<NNNN>_<topic>_seed.sql` → **入版本控制**（产品默认配置，例如 scoring_config）
  - `seed.local.sql` → **gitignore**（admin 用户名 / 临时密码 / 信源凭据等敏感数据）
- 所有 timestamp 列用 `TIMESTAMPTZ`，DB 内 UTC 存储；展示层加时区
- 列名 `snake_case`；Drizzle 的 TS 字段名 `camelCase`，由 schema 定义自动映射
- 任何破坏性 migration（drop column / type change）需在 PR description 列出回滚 SQL

---

## 5. API（Next.js Route Handlers）

- 所有入参经 **Zod schema** 校验；校验错误统一转 `{ error: { code: 'VALIDATION', message, details } }`
- 响应错误结构 `{ error: { code, message, details? } }`（design.md §9）
- 分页统一 cursor 模式：`?cursor=<base64>&limit=<n>`，返回 `{ items, nextCursor }`
- 路径分组：
  - `/api/<resource>` → viewer+
  - `/api/<resource>/...` POST/PUT/DELETE → editor+ 或 admin（在中间件层判定）
  - `/api/admin/*` → admin 专属
- 中间件统一做 RBAC，禁止在 handler 内重复判权（避免漏判）
- 不在 handler 内拼 SQL 或调 LLM；通过 `packages/core` / `packages/llm` 暴露的函数

---

## 6. 错误处理

```ts
// packages/shared/errors.ts
export class AppError extends Error {
  constructor(public code: string, message: string, public details?: unknown) {
    super(message)
  }
}
export class SourceFetchError extends AppError { /* code: 'FETCH_*' */ }
export class LlmError extends AppError { /* code: 'LLM_*' */ }
export class QuotaExceededError extends AppError { /* code: 'QUOTA_*' */ }
```

- 所有抛出的错误是 `AppError` 子类；未知错误兜底转 `AppError('INTERNAL', ...)`
- **绝不静默吞错**；catch 后必须二选一：log 或 re-throw
- LLM / fetcher 类错误重试在 worker 层做，不下沉到 core 层
- 业务可恢复错误（quota 超限、信源失败）走业务路径，不抛异常

---

## 7. 日志（Pino）

- 结构化 JSON，level 用 `debug / info / warn / error / fatal`
- **PII 黑名单**：手机号 / Token / Cookie / unionid 全文 / 密码 hash —— 不写日志
- worker job 必带 `{ jobId, queue, sourceId?, itemId? }` 上下文
- 错误日志必带 `error.code` 与 stack（用 `pino` 自带 `serializers.err`）
- 生产 level = `info`，开发 level = `debug`

---

## 8. 认证与权限

- 密码：`bcrypt(work_factor=12)`；不允许其他散列方式
- JWT 仅放 httpOnly cookie，`SameSite=Lax`，2h 过期 + 滑动续期（design.md §13）
- 三角色 RBAC：`viewer / editor / admin`，存 `users.role`
- session 中间件在 `app/middleware.ts` 统一拦截，handler 内不重复检查

---

## 9. 时区

- Docker stack 全 service 注入 `TZ=Asia/Shanghai`（design.md §12）
- DB 存 UTC（`TIMESTAMPTZ`）；展示层用 `dayjs().tz('Asia/Shanghai').format(...)`
- BullMQ cron 表达式按容器 TZ 解析（即上海时间）
- **不允许**直接用 `new Date().toLocaleString()` 渲染时间（行为依赖宿主 locale）；必须经 dayjs

---

## 10. BullMQ / Worker

- queue 配置：retry 默认 3 次指数退避（200ms → 800ms → 3.2s）
- 单 job timeout 默认 60s；超长 job（playwright 抓取）允许扩到 5min，需在 queue 注册时显式声明
- 信源连续失败 7 天 → 调度器自动 `enabled=false` 并 emit alert（design.md §4.2）
- 配额限速 incr **必须**经 `packages/core/quota.ts` Lua 脚本（design.md §5.1）；禁止在 handler 直接 `redis.incr`
- 入 `pending_over_quota` backlog 的 item **不消耗预算**

---

## 11. LLM 调用

- 全部经 `packages/llm/{deepseek,kimi,qwen}.ts` 封装；handler 不直连 vendor SDK
- 评分类调用必须用 `response_format: json_schema` 强约束（design.md §6.1）
- prompt 模板路径 `packages/llm/prompts/<task>.ts`，单文件 ≤ 200 行
- 失败重试 2 次 + 兜底默认值；不允许 swallow + 默认值（必须 log warn）
- 不允许把用户隐私字段（手机号、邮箱）拼进 prompt

---

## 12. 前端

- 默认服务端组件（RSC）；客户端组件仅在需要 React state / 浏览器 API 时声明 `'use client'`
- 数据获取：服务端组件直接 `await db.query(...)`；客户端用 TanStack Query
- 筛选状态写 URL search params（用 `nuqs` 或自家 hook 封装），不放本地 state
- shadcn/ui 组件按需通过 CLI 添加（`pnpm dlx shadcn@latest add card`），**不批量复制**全部组件
- 中文 UI **唯一**；不引入 i18n 框架；字符串字面量直接写中文，硬编码不抽 key

---

## 13. 测试

- Vitest（单元 + 集成）+ Playwright（E2E）
- 测试文件就近：`foo.ts` ↔ `foo.test.ts`（同目录）
- **禁止 mock 数据库**；集成测试用 Testcontainers 起真 Postgres + Redis
- 测试名描述**行为**：`"超额普通条目转 pending_over_quota 不消耗预算"`，不是 `"test admit"`
- `packages/core/scoring.ts` 与 `packages/core/quota.ts` 单元测试覆盖率 **必须 100%**（design.md §15）
- 评分公式回测：参数变更前在历史 500 条上跑 A/B（脚本 `scripts/scoring-backtest.ts`）

---

## 14. 依赖管理

- 已在 design.md §2 锁定的栈**不允许替换**（不要拿 Prisma 换 Drizzle、不要拿 axios 换 fetch、不要拿 moment 换 dayjs）
- 新增 runtime dep 必须在 PR description 写明：理由 / 替代方案 / bundle size 影响
- dev dep 加得宽松，但**不要**重复职责（项目用 vitest 就别再加 jest）
- LLM SDK 统一用 OpenAI SDK 兼容协议（DeepSeek / Kimi / Qwen 都支持）

---

## 15. Commit / PR

- commit 格式：`[DMA-XX] 动词 + 范围`，例：`[DMA-30] 实现 admitToScoring Lua 脚本`
- 一个 commit 只做一件事；M0–M5 阶段每个 sub-agent 任务对应 1–N 个 commit
- PR description 必含 4 段：**变更范围 / 风险 / 测试方法 / 回滚方法**（与 task-template `rollback` 字段呼应）
- 禁止 `--no-verify` skip hook（spec 是否漂移由 hook 检查）

---

## 16. 安全 / 数据最小化

- 不存原始 HTML 快照（FR-12）；fetcher 解析后立即丢弃 raw bytes
- 不拉 / 不存用户手机号（requirements §10.2 / §12）
- 抓取遵守 robots.txt；UA 标识 `FE-Radar Bot`；同站请求间隔 ≥ 1s
- 任何外部传入字符串都视为不可信；插入 DOM / shell / SQL 前必须 escape / parameterize
- 90 天 cleanup（design.md §14）只清内容类表，不清 `sources / entities / scoring_config / users`

---

## 17. 项目专属规则

| 主题 | 规则 |
|---|---|
| D2_chain 评分 | **必须**由 `packages/core/scoring.ts` 代码计算（NER 命中 + 关注圈），LLM 不得参与；保证自家公司零漏报 |
| alert_type 触发 | 必须在 `packages/core/alert.ts:computeAlert()` 单一入口；不允许多处计算 |
| scoring_config 调整 | 通过 admin 后台 `PUT /api/scoring-config`，不允许直接改代码常量 |
| 信源管理 | `sources` 表 admin 后台 CRUD，**禁止**硬编码 URL 到代码 |
| 实体词典 | `entities` 表 admin 后台 CRUD，**禁止**硬编码 C1/C2 名单到代码 |
| 时区 | 所有 cron 字符串注释**必须**说明"按 Asia/Shanghai 解析" |

---

## Project Customization Log

- v1.0 (2026-05-08)：基于 FE-Radar Plan v0.6 首次客户化，覆盖 17 项；后续依据 M0–M5 实施反馈在 retro 阶段迭代。
