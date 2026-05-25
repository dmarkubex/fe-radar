# BEGIN AI_KERNEL

## AI Workflow Kernel

This project uses the AI coding kernel. Before starting any substantive work, read these files in order:

1. `AI_index.md` — project snapshot of the kernel rules
2. `.ai/shared/agreements.md` — cross-project execution agreements
3. `handoff.md` — current project control state
4. `.ai/project-overrides.md` — project-specific rules (if present)
5. `.ai/shared/style-invariants.md` — code style and architecture invariants
6. `.ai/shared/task-template.md` — standard task format for spec/tasks.md

### Agents

| Agent       | Role                                   |
| ----------- | -------------------------------------- |
| Claude Code | Coordinator + Planner + Plan-Fix (you) |
| Codex       | Parallel Executor + Code-Fix           |
| Antigravity | Independent Reviewer (Google)          |

### Three Operating Modes

| Mode     | When                                          | Stages                                                                             |
| -------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Lite     | small fixes, single file, low risk            | Plan(guard+restate) → Execute → Review → Close                                     |
| Standard | cross-module, low-medium risk, single agent   | Plan(guard+restate+tasks) → Execute → Code Review → Fix → Close                    |
| Full     | high risk, multi-agent parallel, core systems | Plan → Review Plan → Fix Plan → Execute → Review Code → Fix Code → Release → Retro |

Default to Lite. Escalate based on risk and scope.

### Key Rules

- In Lite Mode, produce a restate block (Goal / Plan / Risks) before any code change.
- In Standard and Full Mode, all tasks in `spec/tasks.md` must use the template format (goal, constraints, ask_agent_first, owner, scope, rollback, acceptance).
- After producing spec, run `/init` to update CLAUDE.md with project context (first time or when context is stale).
- After planning, hand off to Antigravity for review (Full Mode only). Fix critical findings before proceeding.
- Delegate implementation to Codex for parallel execution. After code review by Antigravity, Codex fixes findings.
- Maintain `handoff.md` as the control token. When Owner is Human, stop and wait.
- Read `.ai/shared/style-invariants.md` before writing code to prevent architectural drift.
- Every task must have a concrete rollback plan.
- Write reusable lessons to `.ai/shared/lessons.md` via `.ai/scripts/promote-lesson.sh`.

# END AI_KERNEL

# BEGIN PROJECT

## FE-Radar — 远东控股产业情报雷达

500 人内部使用的电力 / 电线电缆 / 储能 / 能源行业产业情报雷达。每 6 小时抓取行业动态 → 过滤 / 评分 / 聚类 / 告警 → 时间线 + 精选 + 日报呈现。

**两条产品哲学**：

1. **信源比信息重要** — 先精选信源，再处理信息（T1/T2/T3 分级 + C1/C2/C3 关注圈）
2. **能用脚本就别用 Agent** — LLM 只做语言任务，规则 / 阈值 / 聚类用代码控制

## 文档入口（必读）

| 文件                                                                  | 内容                                                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [spec/requirements.md](spec/requirements.md) v0.7                     | WHAT — 12 FR / 7 NFR / 关注圈 / 信源分级 / 5 维评分 / NER 7 类 / 告警 / 认证 / 数据合规                                                             |
| [spec/design.md](spec/design.md) v0.7                                 | HOW — 架构 / 模块拆分 / 抓取层（含代理池） / 8 阶段 pipeline（含 scrubber） / 评分 / 聚类 / 数据 schema / API / 认证（含合并） / 部署 / 监控 / 风险 |
| [spec/tasks.md](spec/tasks.md) v0.2                                   | 60 task / 8 sub-agent / 跨 milestone 依赖 / 风险登记（**Antigravity DMA-24 APPROVED**）                                                             |
| [.ai/shared/style-invariants.md](.ai/shared/style-invariants.md) v1.0 | 17 节代码规范（结构 / 命名 / TS / DB / API / 错误 / 日志 / 认证 / 时区 / BullMQ / LLM / FE / 测试 / 依赖 / Commit / 安全 / 项目专属）               |
| [handoff.md](handoff.md)                                              | 当前控制 token（当前 Stage = Execute / Owner = Codex）                                                                                              |

## 技术栈（不许换）

- **前端 / API**：Next.js 15 App Router + React 19 + TypeScript + Tailwind + shadcn/ui + TanStack Query
- **DB**：Postgres 16 + pgvector + zhparser（自定义 Dockerfile）+ Drizzle ORM
- **队列**：BullMQ + Redis 7
- **LLM**：本地 Qwen3.6 27B（预筛 / NER / embedding）+ DeepSeek V4 Pro（5 维评分 / 摘要 / 翻译）+ Kimi K2.6（每日日报 200K ctx）
- **认证**：Auth.js · M0–M3 本地账号（bcrypt 12）/ M4+ 钉钉 SSO 并存（`mergeOrCreateUser` 合并）
- **部署**：Docker Swarm via Portainer · 内网 only · `TZ=Asia/Shanghai` · MinIO 备份

## Monorepo 结构

```
apps/
  web/            # Next.js 一体化（前端 + API）
  worker/         # BullMQ consumer（fetcher / pipeline / scheduler / cleanup）
packages/
  db/             # Drizzle schema / migration / seed / repos
  llm/            # Qwen / DeepSeek / Kimi 三家 SDK 封装 + scrubber 中间件
  core/           # 业务规则纯函数（scoring / quota / cluster / alert / scrubber / priority）
  shared/         # AppError 子类 / 类型 / dayjs / 常量
deploy/           # stack.yml / Dockerfile / secrets
scripts/          # 评分回测 / 信源验证
```

**模块边界**（违例 = code review major）：

- `apps/web` 与 `apps/worker` **不互相 import**
- 跨 package 必须经 `index.ts` 公共出口
- `packages/core` **不依赖** `packages/db`（业务规则纯函数化便于单测）
- 无循环依赖（CI `madge --circular`）

## 8 个 Sub-Agent（Codex Execute 用）

| Agent           | scope                                                                 |
| --------------- | --------------------------------------------------------------------- |
| `agent-infra`   | monorepo / docker / CI / 监控 / `deploy/*` / `scripts/*`              |
| `agent-db`      | `packages/db/**`（schema / migration / seed / repos）                 |
| `agent-llm`     | `packages/llm/**`（Qwen / DeepSeek / Kimi clients + scrubber 中间件） |
| `agent-core`    | `packages/core/**` + `packages/shared/**`（业务规则纯函数）           |
| `agent-worker`  | `apps/worker/**`（fetcher / pipeline jobs / scheduler / cleanup）     |
| `agent-web-api` | `apps/web/app/api/**` + `apps/web/lib/api/**` + `middleware.ts`       |
| `agent-web-ui`  | `apps/web/app/**`（除 api/）+ `components/**` + `hooks/**`            |
| `agent-auth`    | `apps/web/app/api/auth/**` + `apps/web/lib/auth/**` + users 表协作    |

## Milestone 计划

| M   | 主题                             | 目标日期   | task |
| --- | -------------------------------- | ---------- | ---- |
| M0  | 脚手架与基线                     | 2026-05-17 | 10   |
| M1  | 抓取层（含代理池）               | 2026-05-31 | 10   |
| M2  | Pipeline 与评分（含 scrubber）   | 2026-06-14 | 15   |
| M3  | 前端核心页面                     | 2026-06-22 | 8    |
| M4  | 告警 / 日报 / 钉钉 SSO（含合并） | 2026-06-27 | 9    |
| M5  | 后台 / 监控 / 上线               | 2026-06-30 | 8    |

## 项目专属硬约束（违例不接受）

- **D2_chain 评分必须代码计算**（NER 命中 + 关注圈），LLM 不得参与；保证自家公司零漏报
- **`alert_type` 触发统一在 `packages/core/alert.ts:computeAlert()` 单一入口**
- **配置必须存数据库**（scoring_config / sources / entities），不许硬编码
- **不存原始 HTML 快照**（FR-12）；fetcher 解析后立即丢弃
- **不拉 / 不存用户手机号**（仅 unionid + name + dept）
- **公网 LLM 调用前必经 `packages/core/scrubber.ts`**（脱敏 + audit log；命中 PII 阈值跳过 LLM）
- **代理池仅用于绕 IP 封禁**，**不得绕 robots.txt**（合规底线）
- **数据保留 90 天**（items / item_analysis / item_entities / cluster_items / feedbacks / daily_reports）；配置类（sources / entities / scoring_config / users）永久
- **bcrypt(work_factor=12)**；JWT 仅 httpOnly cookie；2h 过期 + 滑动续期
- **TZ=Asia/Shanghai** 注入所有 service；不许 `new Date().toLocaleString()`，必须 `dayjs().tz()`
- **scoring_config seed 用 `ON CONFLICT DO NOTHING`**，重跑 migration 不覆盖 admin 后台改过的配置
- **限速器 incr 必经 `packages/core/quota.ts` Lua 脚本**（双独立计数器：normal ≤ 1300 + priority ≤ 200）
- **cluster 创建必带 Redis 分布式锁**（worker 装配层；防多 worker 并发建簇）
- **commit message 格式**：`[DMA-XX] 动词 + 范围`；`/init` 不要重写本文件而是 append project section

## 关键陷阱（已踩过的坑）

1. **zhparser 不在 `pgvector/pgvector:pg16` 默认镜像**：M0 的 `deploy/Dockerfile.postgres-zhparser` 必须装 zhparser；fallback 到 `pg_trgm` + ILIKE
2. **playwright 内存泄漏**：BrowserContext 必须池化复用 + 周期 restart
3. **本地 Qwen GPU 容量未知**：预筛失败 fallback DeepSeek
4. **政府站反爬**：T1 信源（国家能源局 / 发改委 / 工信部）走代理池 + 真实 UA 轮换；同站 ≥ 1s 间隔
5. **聚簇竞态**：多 worker 同时为相似 item 建簇，必须 Redis 锁 + Lua 原子
6. **priority 饥饿**：监控 priority backlog 陈旧度（>24h 占比 >30% 红色告警）
7. **钉钉账号合并**：首次钉钉登录必须经 `mergeOrCreateUser`；name+dept 匹配多个候选不自动合并，写 `merge_conflicts` 表等 admin confirm
8. **cleanup 事务 FK**：feedbacks.item_id `ON DELETE CASCADE`、clusters.lead_item_id `ON DELETE SET NULL`，不然 cleanup 卡死

## Plan Stage 全程关卡（已通过）

DMA-6 (3 Major) → v0.2 → DMA-18 (6 Major + 2 Minor) → v0.4 → DMA-19 (4 Major + 1 Minor) → v0.5 → DMA-20 (2 Major + 1 Minor) → v0.6 → DMA-21 ✅ pass → tasks v0.1 → DMA-23 (3 Critical + 3 Edge REJECTED) → tasks v0.2 + spec v0.7 → **DMA-24 APPROVED ✅**

## Linear 集成（约定）

- Workspace `Dmarkubex` / Team `DMA` / 项目 `FE-Radar — 远东控股行业情报雷达` (id `fa1fe194-bc72-457e-a9c0-aa4119732543`)
- **issue label 规则**：人决策 → **不打 label**；agent 自动处理（评审 / 编程） → 打 `codex` 或 `antigravity` label
- 实施 task 进 Linear 时一律打 `codex` label，由用户 Codex 自动化拾取

## v1.1 — Commodity Briefing

### 背景

FE-Radar v1.1 在 v1.0 产业情报雷达基础上新增**原料价格视角**：每个工作日 **16:00 Asia/Shanghai** 自动生成"铜锂大宗商品·每日行情简报"（电解铜 CU + 电池级碳酸锂 LC），通过钉钉群机器人 actionCard + 站内深链推送，辅助采购、成本预判、销售报价决策。v1.0 是"看新闻"，v1.1 是"看价格"；两者共用 sources / pipeline / 关注圈 / LLM / 推送通道。**本模块只增不改**，禁止修改 v1.0 已交付字段与表。

规格文档：`spec/v1.1-commodity-briefing/requirements.md` v0.3 / `design.md` v0.4 / `tasks.md` v0.4（22 task · 3 Phase · Antigravity DMA-153 APPROVED-with-conditions）

### 技术栈差异（v1.1 新增依赖，不替换 v1.0）

| 依赖                         | 用途                                                            | 固定版本约束                  |
| ---------------------------- | --------------------------------------------------------------- | ----------------------------- |
| `diygod/rsshub` Docker image | 自部署内网 RSSHub，包装 SMM / 生意社 / 长江有色 / 中汽协 RSS 源 | pin 到 digest，不用 `:latest` |
| `docxtemplater` + `pizzip`   | Worker 端 docx 模板渲染（`{{placeholder}}` 填充）               | 不替换为其他模板引擎          |
| `sanitize-html`              | quotes adapter raw_text strip HTML 标签（NFR-102 审计用）       | 已在 packages/llm，复用       |
| `minio` JS SDK               | Worker 端上传渲染后 docx 到 `fe-radar-briefings` bucket         | 复用 v1.0 MinIO 实例          |

新增环境变量（worker + stack.yml）：`RSSHUB_BASE_URL=http://rsshub:1200`，`BRIEFING_TEMPLATE_PATH=/app/design/templates/briefing.docx`，`BRIEFING_MINIO_BUCKET=fe-radar-briefings`。

### v1.1 硬约束

- **NFR-102 数值精度**：价格数值**禁止 LLM 抽取**；只允许交易所接口 + 正则（`rsshub-extract.ts` regex_rules 数组，admin 可后台维护）；LLM 只生成"行情逻辑总结""走势预判"等语言段落（7 段 BRIEFING_SCHEMA，不含任何数值字段）
- **withScrubber 强制**：briefing-gen job 调 Kimi K2.6 前必经 `packages/core/scrubber.ts`（同 v1.0 日报约束，无例外）
- **template_version 必填**：`commodity_briefings.template_version INT NOT NULL`，模板改版必须 bump，便于历史回看时正确关联渲染版本
- **disabled_at 软删**：`briefing_targets` 删除走 `UPDATE disabled_at=now() + enabled=false`，保留 `briefing_pushes` 审计链（不物理删除）
- **节假日跳过**：`briefing_holidays` 表 admin 一年一次手工维护；三个 BullMQ job（quotes-fetch / briefing-gen / briefing-push）入口统一调 `packages/core isBusinessDay()` 判断，命中节假日直接 return（结构化日志，零 DB 写入）
- **quotes seed 默认 disabled**：`fetcher_type='quotes'` 信源 seed 默认 `enabled=false`，等 adapter 上线后 admin 手动启用
- **seed ON CONFLICT DO NOTHING**：`briefing_template_fields` / `briefing_holidays` seed 仅首次初始化，admin 后台修改不被 reseed 覆盖；新增字段须走新 migration（0010+），禁止直接改 0009 文件

### 关键陷阱（v1.1 新增）

9. **quotes-fetch 与 briefing-gen 竞态**：`briefing-gen` 在 16:00 启动时，15:30 的 `quotes-fetch` 可能因代理池故障仍在队列中积压。precheck 第一步必须先查 BullMQ `queue.getJobCounts('waiting','active','delayed')`，非空延迟 5min ×2 → 仍非空 abort（`gen_status='failed'` + 红色告警），不能把"队列积压"误判为"字段覆盖率不足 → degraded"（design.md §5.2 step 1 / tasks.md T-CB-13 E1 fix）
10. **docx 模板 lint 不可跳过**：`briefing-render.ts` 渲染前必须校验模板中所有 `{{key}}` 都能在 `briefing_template_fields` 表找到；模板纳入 git（`design/templates/briefing.docx`），不允许运行时上传；改版走 PR + lint（tasks.md T-CB-11 / T-CB-09 风险 R9）
11. **钉钉凭据三层 redact**：`briefing_targets.sign_secret` 在 API 响应中必须 mask 为 `***`（non-admin 路径）；Pino logger redact 配置必须含 `webhook_url` + `sign_secret`；Admin UI 输入框 `type=password`（tasks.md T-CB-12 / T-CB-18 / requirements §12 验收第 10 项）
12. **90 天 docx retention**：`commodity_briefings` 元数据保留 90 天（cleanup job DELETE）；docx 文件由 MinIO bucket lifecycle policy 清理（不在 cleanup job 里删 MinIO 对象）；超期下载必须返回 **410 Gone**（不是 404），code=`BRIEFING_DOCX_EXPIRED`（FR-110 / design.md §8）

# END PROJECT
