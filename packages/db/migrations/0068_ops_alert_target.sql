-- 0068_ops_alert_target.sql
-- T-UP-03: 运维断流告警目标开关，与日报/简报推送群隔离。
-- 默认 false：上线后在 admin 打开之前保持静默，零打扰。
-- 禁止把现有行置为 true。
--
-- ROLLBACK (manual only — do not auto-run):
--   ALTER TABLE briefing_targets DROP COLUMN IF EXISTS ops_alert_enabled;

BEGIN;

ALTER TABLE briefing_targets
  ADD COLUMN IF NOT EXISTS ops_alert_enabled BOOLEAN NOT NULL DEFAULT false;

COMMIT;
