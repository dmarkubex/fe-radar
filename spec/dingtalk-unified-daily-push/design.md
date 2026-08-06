# 钉钉合并日报推送设计

状态：Ready for Grok Implementation

日期：2026-08-06

## 最小设计

复用现有 `fe-briefing-push` BullMQ 队列与 `briefing_targets`。队列保留 `briefingId > 0` 的手工简报重推语义；`briefingId = 0` 改为每分钟执行一次数据库调度检查。这样后台修改后下一分钟生效，不需要 Web 跨模块导入 worker，也不需要动态删除/重建 repeat job。

## 数据库

新增迁移 `packages/db/migrations/0055_daily_push_config.sql`：

1. `daily_push_config` 单例表：
   - `id INTEGER PRIMARY KEY CHECK (id = 1)`
   - `enabled BOOLEAN NOT NULL DEFAULT FALSE`
   - `send_time TEXT NOT NULL DEFAULT '16:15'`，DB CHECK `HH:mm`
   - `schedule_mode TEXT NOT NULL DEFAULT 'business_days'`，CHECK `daily|business_days`
   - `base_url TEXT NOT NULL DEFAULT 'http://fe-radar.internal'`
   - `updated_by BIGINT NULL REFERENCES users(id)`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
   - seed 使用 `INSERT ... ON CONFLICT DO NOTHING`
2. `daily_pushes` 审计表：
   - `id BIGSERIAL PRIMARY KEY`
   - `report_date DATE NOT NULL`
   - `target_id BIGINT NOT NULL REFERENCES briefing_targets(id)`
   - `briefing_id BIGINT NULL REFERENCES commodity_briefings(id) ON DELETE SET NULL`
   - `daily_report_present BOOLEAN NOT NULL`
   - `briefing_present BOOLEAN NOT NULL`
   - `push_status TEXT NOT NULL CHECK pending|succeeded|failed`
   - `attempt_count INTEGER NOT NULL DEFAULT 0`
   - `error_detail TEXT NULL`
   - `pushed_at TIMESTAMPTZ NULL`
   - UNIQUE `(report_date, target_id)`

迁移必须含注释形式 rollback SQL；不得自动执行 rollback。

## 共享卡片构造

新增 `packages/core/src/daily-push-card.ts` 纯函数，输入日期、日报 sections、可选简报 ID/状态/载荷、baseUrl，输出 `{ title, text, btns }`。

- 五个日报栏目按政策/市场/技术/项目/公司顺序展示；每栏做确定性截断，卡片保持可读，完整内容留给网页。
- 简报只展示已有语言字段或生成状态，不从文本抽取/改写任何价格数值。
- 有日报才添加“查看产业日报”；有简报才添加“查看铜锂行情简报”。
- 对 `baseUrl` 使用 `new URL()` 校验并安全拼接固定相对路径。

## Worker

新增 `apps/worker/src/jobs/daily-push.ts`：

1. 使用 `dayjs().tz(APP_TIMEZONE)` 取得当前日期与 `HH:mm`。
2. 读取单例配置；disabled、时间不匹配、工作日模式命中周末/节假日时结构化 skip。
3. 加载当天日报、可推送简报和启用且未软删目标。
4. 两份内容都不存在或目标为空时结构化 skip，不写虚假 succeeded。
5. 对每个目标先查 `daily_pushes`；已 succeeded 则幂等跳过，failed 可由显式测试/后续人工机制处理，不在非命中分钟无限重试。
6. 复用 `sendActionCard()` 与现有 1s/4s/16s、最多 3 次逻辑；成功或最终失败 upsert 审计。

门 B 修订：第 5 步必须在发送前用 `INSERT ... ON CONFLICT DO NOTHING ... RETURNING` 原子写入 `pending` 作为发送 claim；只有成功 claim 的 worker 可以调用 webhook。禁止“先 SELECT、发送后再 upsert”，否则并发 tick 会重复发卡。完成后按 claim 主键 UPDATE succeeded/failed。

将 `BRIEFING_PUSH_SCHEDULE_CRON` 改为每分钟 tick（BullMQ 六段 cron：`0 * * * * *`）。`bootstrap.ts` 中 sentinel `briefingId=0` 调 `runScheduledDailyPush()`；正数仍调现有 `runBriefingPush()`。`briefing-gen.ts` 移除生成成功后立即入队的单独简报推送，保留 16:00 生成和手工 repush。

注册新 repeat 前必须显式移除旧 `0 5 16 * * 1-5` repeat，避免 Portainer 升级后旧 16:05 与新 minute tick 并存。

`daily_pushes` 纳入现有 cleanup 90 天事务清理。`sendActionCard()` 必须继续支持 `sign_secret IS NULL` 的合法目标：secret 为空时直发原 webhook，非空时才加签。

## Web API 与 UI

- `GET /api/briefing/schedule`：admin only，返回单例配置及最近推送摘要。
- `PUT /api/briefing/schedule`：admin only，Zod 校验 `enabled/sendTime/scheduleMode/baseUrl`，更新 `updatedBy/updatedAt`。
- `/admin/briefing/targets` 复用现有页面，在目标列表前增加“合并日报定时发送”表单；明确显示固定时区和“无目标不会发送”。
- 现有 `POST /api/briefing/targets/[id]/test` 改用共享卡片纯函数和当天实际数据发送 ActionCard。继续对 webhook 加签，继续只向 admin 开放。
- `briefing_targets.webhook_url` 与 `sign_secret` 都是凭据：任何 targets API 响应不得返回原值。列表/创建/更新响应只返回 `webhookUrlMasked`、`webhookConfigured` 与 `signSecretConfigured`；编辑表单留空表示保持原值，只有管理员显式输入新 URL 时才更新。

## 文件清单（Grok 只可修改这些文件）

- `packages/db/migrations/0055_daily_push_config.sql`（新增）
- `packages/db/src/schema-commodity.ts`
- `packages/db/src/__tests__/daily-push-migration.test.ts`（新增）
- `packages/core/src/daily-push-card.ts`（新增）
- `packages/core/src/index.ts`
- `packages/core/src/__tests__/daily-push-card.test.ts`（新增）
- `apps/worker/src/jobs/daily-push.ts`（新增）
- `apps/worker/src/jobs/briefing-push.ts`
- `apps/worker/src/jobs/briefing-gen.ts`
- `apps/worker/src/queues.ts`
- `apps/worker/src/scheduler.ts`
- `apps/worker/src/scheduler-main.ts`
- `apps/worker/src/bootstrap.ts`
- `apps/worker/src/jobs/__tests__/daily-push.test.ts`（新增）
- `apps/worker/src/jobs/__tests__/briefing-gen.test.ts`
- `apps/worker/src/jobs/__tests__/briefing-push.test.ts`
- `apps/worker/src/jobs/cleanup.ts`
- `apps/worker/src/jobs/__tests__/cleanup.test.ts`
- `apps/worker/src/lib/dingtalk-bot.ts`
- `apps/worker/src/lib/__tests__/dingtalk-bot.test.ts`
- `apps/worker/src/__tests__/scheduler.test.ts`
- `apps/worker/src/__tests__/runner-announcements.test.ts`
- `apps/web/lib/api/briefing-schema.ts`
- `apps/web/app/api/briefing/schedule/route.ts`（新增）
- `apps/web/app/api/briefing/schedule/__tests__/route.test.ts`（新增）
- `apps/web/app/api/briefing/targets/[id]/test/route.ts`
- `apps/web/app/api/briefing/targets/[id]/test/__tests__/route.test.ts`（新增）
- `apps/web/app/api/briefing/targets/route.ts`
- `apps/web/app/api/briefing/targets/[id]/route.ts`
- `apps/web/app/api/briefing/__tests__/targets-schema.test.ts`
- `apps/web/components/briefing/target-form.tsx`
- `apps/web/components/briefing/schedule-form.tsx`（新增）
- `apps/web/components/briefing/target-table.tsx`
- `apps/web/app/(admin)/admin/briefing/targets/page.tsx`
- `apps/web/components/layout/app-shell.tsx`
- `deploy/stack.yml`
- `deploy/compose.portainer-current.yml`
- `deploy/env.example`

## 禁改清单

- 当前已 dirty 的 alerts/timeline/websearch/NER/scoring 文件。
- `packages/db/migrations/0054_websearch_quality_config.sql`。
- `apps/web/lib/auth/**`、`apps/web/auth.ts`、`apps/web/middleware.ts`。
- 既有 `0001`–`0054` migration。
- `spec/**` 与 `.ai/protocols/**`。

## 验证命令

1. `pnpm --filter @fe-radar/db test -- daily-push-migration`
2. `pnpm --filter @fe-radar/core test -- daily-push-card`
3. `pnpm --filter @fe-radar/worker test -- daily-push briefing-push briefing-gen scheduler runner-announcements`
4. `pnpm --filter @fe-radar/web test -- briefing schedule targets-schema`
   - 必须直接导入并调用测试推送 route，断言真实 ActionCard payload；不得只在测试里手写一份镜像 payload。
5. `pnpm --filter @fe-radar/worker exec vitest run src/jobs/__tests__/cleanup.test.ts src/lib/__tests__/dingtalk-bot.test.ts`
6. 对实际改动文件运行仓库现有 ESLint 命令。
7. `git diff --check`
8. 全量 typecheck 若仍被既有 `apps/web/lib/api/alerts-query.ts:62` 阻断，必须精确记录，不得修改该文件。

## 回滚

- 部署回滚：恢复 worker/web/migrate 上一镜像 digest。
- 数据回滚：先停用 `daily_push_config`，再按 migration 尾部 rollback 顺序删除 `daily_pushes`、`daily_push_config`；不删除 `briefing_targets`、`daily_reports`、`commodity_briefings`。
