# 钉钉合并日报推送 Review Log

## 实现记录（Grok CLI 填写）

### Round 0 — 初版实现（T-DUP-01/02/03）

- **状态**：代码与定向测试完成；未 commit / push / 部署。
- **改动文件**：见 git 本任务范围（0055 / schema / daily-push-card / daily-push job / schedule API/UI / deploy 注释 等）。
- **自检**：定向测试通过；web typecheck 被既有 dirty `alerts-query.ts:62` 阻断未修。

### Round 1 返修（门 B REQUEST_CHANGES → 5 Major + 1 Minor）

- **状态**：5 Major + 1 Minor 均已修；未 commit / push / 部署。
- **改动文件（本轮）**：
  1. `apps/worker/src/jobs/daily-push.ts` + `.../__tests__/daily-push.test.ts`
     — 发送前 `INSERT pending … ON CONFLICT DO NOTHING RETURNING` 原子 claim；仅 claim 成功者发 webhook；完成后 `UPDATE` claim 主键；补并发 claim 测试；空 `{}` 日报用 `hasDailyContent`。
  2. `apps/worker/src/lib/dingtalk-bot.ts` + `.../__tests__/dingtalk-bot.test.ts`
     — `resolveWebhookUrl`：`signSecret` 空/空白不写 timestamp/sign；非空保持 HMAC 加签。
  3. `apps/worker/src/queues.ts`（`BRIEFING_PUSH_LEGACY_CRON`）
     `apps/worker/src/scheduler.ts`（`removeLegacyBriefingPushRepeat` + `scheduleBriefingPushCron` 先删后注册）
     `apps/worker/src/scheduler-main.ts`（走同一 `scheduleBriefingPushCron`）
     `apps/worker/src/__tests__/scheduler.test.ts`（bootstrap 路径与 main 注册路径均断言 remove→add）。
  4. `apps/worker/src/jobs/cleanup.ts` + `.../__tests__/cleanup.test.ts`
     — `daily_pushes` 按 `report_date` 90 天删除并计入 `deletedDailyPushes`。
  5. `deploy/stack.yml` + `deploy/compose.portainer-current.yml`
     — worker/scheduler/web 的 `REQUIRE_DB_TABLES` 追加 `public.daily_push_config,public.daily_pushes`（compose 原 worker/scheduler 无表清单时一并补齐）。
  6. `packages/core/src/daily-push-card.ts`（export `hasDailyContent`）+ core 测试；
     web test 推送路由同步用 `hasDailyContent`（空 `{}` 不算日报 present）。
- **自检结果**：
  1. db `daily-push-migration` → **4 passed**
  2. core `daily-push-card` → **14 passed**
  3. worker：`daily-push` + `briefing-push` + `briefing-gen` + `scheduler` + `runner-announcements` + `cleanup` + `dingtalk-bot` → **7 files / 61 passed**
  4. web schedule + targets-schema → **26 passed**
  5. ESLint（本轮改动 TS/TSX）→ **0 errors**
  6. `git diff --check`（本轮路径）→ **clean**
- **与 design 偏离**：无（scheduler-main 复用 `scheduleBriefingPushCron` 而非内联 duplicate remove，语义等价且覆盖双入口）
- **设计缺口**：无

## Codex 独立评审

- verdict: REQUEST_CHANGES（Round 1）
- findings:
  1. **Major — 并发幂等竞态**：`daily-push.ts` 先 SELECT，发送成功后才 upsert；两个并发 tick 可同时发送。必须以唯一键 INSERT pending claim 后再发。
  2. **Major — 可选无签名目标不可用**：`sendActionCard()` 总是加签；`sign_secret IS NULL` 会用空密钥生成无效签名。必须仅在 secret 非空时加签。
  3. **Major — 旧 repeat 未迁移**：改变 cron pattern 不会可靠删除线上旧 16:05 repeat；必须注册前显式移除旧 pattern。
  4. **Major — 90 天 retention 漏项**：`daily_pushes` 未加入 cleanup，违反项目数据保留约束。
  5. **Major — 部署前置表检查漏项**：worker/scheduler/web 的 `REQUIRE_DB_TABLES` 未加入 `daily_push_config,daily_pushes`，部署无法 fail-fast 验证 migration 0055。
  6. **Minor — 空日报审计不准确**：`Boolean(sections)` 把 `{}` 当作日报存在，导致 no-content 原因和审计标记不一致；应按五个栏目实际非空判断。
- runtime acceptance: Pending

### Round 1 补充评审（独立 reviewer）

- verdict: REQUEST_CHANGES（Round 2 required）
- findings:
  1. **Major — webhook URL 前端泄漏**：targets API/UI 返回并显示含 access token 的完整 `webhook_url`，违反 NFR-02 与 v1.1 凭据边界。必须改成 mask/configured 状态；编辑时留空保持原值。
  2. **Minor — schema/migration 默认值漂移**：Drizzle `id.default(1)` 与 0055 SQL 无 DEFAULT；移除 Drizzle default 或显式对齐。
  3. **Minor — 测试发送路由无真实测试**：现有测试手写 ActionCard 镜像，没有调用 route，不能防止实现漂移；新增 route 测试。

### Round 2 返修（Grok CLI）

- **状态**：Major + 2 Minor 已修；未 commit / push / 部署。
- **改动文件**：
  1. `apps/web/lib/api/briefing-schema.ts` — `maskWebhookUrl` / `toPublicTarget`（`webhookUrlMasked` / `webhookConfigured` / `signSecretConfigured`；mask 剥离 query，无 access_token）
  2. `apps/web/app/api/briefing/targets/route.ts` — GET/POST 响应经 `toPublicTarget`
  3. `apps/web/app/api/briefing/targets/[id]/route.ts` — PUT 响应脱敏；仅显式非空 `webhookUrl` 才更新；secret 空=保持
  4. `apps/web/components/briefing/target-table.tsx` / `target-form.tsx` — 只显示 mask；编辑 webhook/secret 留空=保持；创建仍必填 webhook
  5. `apps/web/app/api/briefing/targets/[id]/test/__tests__/route.test.ts`（新增）— 直接 import route：401/403、422 无内容、日报-only 加签、简报-only 无签、合并卡、钉钉 502 且响应无 token/secret
  6. `apps/web/app/api/briefing/__tests__/targets-schema.test.ts` — mask/public DTO 用例
  7. `packages/db/src/schema-commodity.ts` — 移除 `dailyPushConfig.id.default(1)`；seed 仍显式 id=1
  8. `packages/db/src/__tests__/daily-push-migration.test.ts` — 断言 `id.hasDefault === false`
- **自检结果**：
  1. db daily-push-migration → **4 passed**
  2. core daily-push-card → **14 passed**
  3. worker 定向 + cleanup + dingtalk-bot → **61 passed**
  4. web targets-schema + schedule + **test route** → **36 passed**
  5. ESLint（本轮文件）→ **0**
  6. `git diff --check` → **clean**
- **与 design 偏离**：无
- **设计缺口**：无

## Codex 最终复审

- verdict: **APPROVE**
- closure: Round 1 / Round 2 的 6 个 Major 与 3 个 Minor 均已关闭。
- verification: db 4、core 14、worker 61、web 36，共 115 个定向测试通过；受影响文件 ESLint、`git diff --check`、db/core typecheck 通过。
- known unrelated blockers: worker 全包 typecheck 仍被既有 `ner-policy.test.ts` 阻断；web 全包 typecheck 仍被既有 `alerts-query.ts` 阻断，本任务未触碰。
- runtime acceptance: Pending deployment and real DingTalk target.
