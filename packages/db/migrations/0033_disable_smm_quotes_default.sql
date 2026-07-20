-- 0033_disable_smm_quotes_default.sql
-- Gap fix A2 (2026-07-13 对抗评审 Finding #6): quotes 信源必须默认 disabled，由 admin 手动启用。
--
-- 背景：
--   0027 曾用 INSERT ... ON CONFLICT (url) DO UPDATE SET enabled=true 强制启用两条 SMM quotes 源。
--   0027 是已发布历史文件（禁止修改），且 packages/db/scripts/migrate.ts 没有 migration ledger，
--   每次部署（docker stack deploy → migrate 容器）都会把所有 *.sql 按文件名顺序整体重跑。
--   原版 0033 用无条件 UPDATE ... SET enabled=false，意味着每次部署都会把 admin 可能已手动
--   启用的源重置为 disabled——反复违反「重跑 migration 不覆盖 admin 后台改过的配置」硬约束。
--
-- 修复策略：配置指纹守卫（仿 0022_bjx_html_fetcher.sql 的 WHERE ... AND config->>'x'='y' 模式）。
--   仅在行仍是「0027 刚 seed 完、admin 从未触碰、从未成功抓取」的原始形状时才 disable：
--     - last_ok_at IS NULL：0027 的 ON CONFLICT DO UPDATE 不会重置 last_ok_at；
--       markSourceSuccess 会写 last_ok_at，故 last_ok_at 非空 = 真正跑过 = admin 已启用并抓过。
--     - fail_count = 0 AND last_error IS NULL：markSourceFailure 会改这两列（admin 启用后抓取失败）。
--   一旦 admin 启用并触发过任意一次抓取（成功或失败），指纹不再匹配，本迁移跳过该行，不再覆盖。
--
-- 边界（本批接受，记入 .ai/shared/lessons.md）：
--   admin「只手动启用、从未触发抓取」的窗口内，下次部署仍会被 disable。但 quotes-fetch cron
--   每天 16:00 会很快抓一次产生 last_ok_at/last_error 记录免疫，窗口极短，可接受。
--   根治（独立 task）：新加 migration 给 sources 表加 seed_applied/admin_touched 标记列。
--
-- 幂等性：migrate.ts 每次 deploy 重跑本文件；指纹守卫保证只在「原始未触碰」状态生效一次。
-- 不修改 0027 历史文件（可能已在生产执行）。

BEGIN;

UPDATE sources
SET enabled = false
WHERE fetcher_type = 'quotes'
  AND url IN (
    'https://hq.smm.cn/h5/cu',
    'https://hq.smm.cn/h5/Li2CO3'
  )
  -- 配置指纹守卫：仅在 admin 从未触碰 + 从未成功抓取时才 disable。
  AND enabled = true
  AND last_ok_at IS NULL
  AND fail_count = 0
  AND last_error IS NULL;

COMMIT;

-- Rollback:
-- UPDATE sources SET enabled = true
-- WHERE url IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3');
