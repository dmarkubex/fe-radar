# Handoff - v1.1 Commodity Briefing Plan Fix (v0.4)

## 1. Current Status
- **Stage**: Plan Approved（Plan Fix v0.4 闭合）
- **Verdict**: ✅ **APPROVED**（Antigravity 报告说明 fix 仅含 Minor/Edge，不需要二轮）
- **Owner**: Human（等 v1.0.0 release tag 解锁 DMA-154 V11-P1 Execute）
- **Linear**: [DMA-153](https://linear.app/dmarkubex/issue/DMA-153)（待人工标 Done）

## 2. Findings Closure (v0.3 → v0.4)

| # | 类型 | 位置 | 修复落点 |
|---|---|---|---|
| M1 | Minor | `commodity_briefings` 无 `template_version` | `design.md §7.1`：新增 `template_version INT NOT NULL DEFAULT 1` + 索引 `commodity_briefings_tpl_version_idx` |
| M2 | Minor | `briefing_targets` 无 `disabled_at` | `design.md §7.1`：新增 `disabled_at TIMESTAMPTZ` + partial index `briefing_targets_active_idx`；T-CB-18 删除走 UPDATE 软删保留 briefing_pushes 审计链 |
| M3 | Minor | `T-CB-09` upsert 未定义 Tier 优先级 | `tasks.md T-CB-09`：upsert 增 `WHERE EXCLUDED_source.tier <= current_source.tier` 防 SMM 覆盖 SHFE 价格 flickering；新增 3 个 Tier 优先级 acceptance 测试 |
| E1 | Edge | `briefing-gen` 与 `quotes-fetch` 队列竞态 | `design.md §5.2 step 1` + `tasks.md T-CB-13` constraint + acceptance：先查 quotes-fetch BullMQ `getJobCounts('waiting','active','delayed')`，非空延迟 5min ×2 → 仍非空 abort gen_status='failed' |
| E2 | Edge | `raw_text` 字符/字节单位歧义 | `design.md §7.1`：统一为 **2000 字符** (Unicode code points)；与 `requirements §9.2` + `tasks T-CB-01` 一致 |
| E3 | Edge | `computeSupportResistance` 样本不足静默 | `design.md §6.5` + `tasks.md T-CB-17` constraint + acceptance：support 或 resistance 为 null 时，详情页 outlook 卡片底部显示『近期数据样本不足，支撑/压力位计算已降级（design.md §6.5）』 |
| E4 | Edge | `briefing_template_fields` seed 幂等 | `tasks.md T-CB-03`：constraint 显式声明 seed 仅首次初始化、admin 后台改不被 reseed 覆盖（DO NOTHING 已保证），新增字段走新 migration（0010+），migration 序号即 seed_version 审计 |

报告原件：`.ai/linear/v11-plan-review-report.md`

## 3. Next Actions

1. **Human**：在 Linear 把 [DMA-153](https://linear.app/dmarkubex/issue/DMA-153) 关闭（Done · v0.4 fix 已落地 + Antigravity 报告说明无需二轮）。
2. **Human/外部**：等 v1.0.0 release tag 推到内网 registry（详见 `handoff.md §8 Release Plan`）→ DMA-154 V11-P1 升 Todo → Codex Execute V11-P1（T-CB-01..05/02b）。
3. **Claude Code**：v1.0.0 release tag 出现后再做 `.ai/handoff.md` Execute-stage 重写，本轮无 Execute 动作（v1.1 Execute 被 v1.0.0 release tag blockedBy）。

## 4. Files Touched This Round

- `spec/v1.1-commodity-briefing/design.md` (v0.3 → v0.4 · header + §5.2 step 1 + §6.5)
- `spec/v1.1-commodity-briefing/tasks.md` (v0.3 → v0.4 · header + T-CB-03/09/13/17)
- `handoff.md` §1.1 (v1.1 row + Last Updated)
- `.ai/handoff.md` (本文件，整体重写为 v0.4 closure 视角)
- `.ai/linear/project.update.md` (本轮 progress 记录)

## 5. Codex Pause Handoff - DMA-46 Worktree Cleanup

- **Trigger**: Human asked Codex to stop after DMA-46 R2 commit and let Claude Code continue.
- **Completed**: Created commit `f22464e [DMA-46] 加固 mock-mode 双层 NODE_ENV 护栏 + cached bcrypt hash`.
- **Commit scope**: exactly 4 files: `apps/web/lib/mock-mode.ts`, `apps/web/lib/auth/users.ts`, `apps/web/lib/__tests__/mock-mode.test.ts`, `apps/web/lib/auth/__tests__/users.test.ts`.
- **Verification evidence before commit**:
  - `grep -R "NEXT_PUBLIC_APP_DATA_MODE" apps packages || true` returned no matches.
  - `git diff --check --cached` passed.
  - `git commit` ran the configured pre-commit hook successfully.
- **Verification blocked**: `CI=true pnpm --filter @fe-radar/web test -- apps/web/lib/__tests__/mock-mode.test.ts apps/web/lib/auth/__tests__/users.test.ts` and `CI=true pnpm --filter @fe-radar/web typecheck` did not reach tests/typecheck because pnpm tried to recreate `node_modules` and registry downloads for `next` / `@next/swc-darwin-arm64` timed out.
- **Uncommitted cleanup started by Codex before pause**: `.gitignore` has a local uncommitted change adding `/AGENTS.md`, `/.ccb/`, `/.ccb-backups/`, and `/.ccb-requests/`; local untracked `AGENTS.md` and `.ccb*` directories were removed.
- **Current git shape at pause**: `master...origin/master [ahead 2]` (`6d7179f` + `f22464e`), with the large unrelated dirty worktree still present.
- **Next owner**: Claude Code.

---
*Plan Fix Sign-off: Claude Code · 2026-05-19 CST*
