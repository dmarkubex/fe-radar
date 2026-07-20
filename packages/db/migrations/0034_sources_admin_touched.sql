-- 0034_sources_admin_touched.sql
-- 用专用字段记录 admin 对信源的真实修改，避免再用抓取状态字段推断管理员意图。
--
-- 已知残余窗口：0027 每次部署仍会清零 fail_count/last_error（不会清 last_ok_at），
-- 因此 0033 在「从未成功抓取但 admin 已手动改过配置」的边界下仍可能被击穿。
-- 本迁移只建立可靠信号；后续 migration 应使用 admin_touched_at IS NULL 做配置守卫。

BEGIN;

ALTER TABLE sources
ADD COLUMN IF NOT EXISTS admin_touched_at TIMESTAMPTZ;

COMMIT;

-- Rollback (manual only): ALTER TABLE sources DROP COLUMN IF EXISTS admin_touched_at;
