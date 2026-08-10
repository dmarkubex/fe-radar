-- 0060_briefing_send_time.sql
-- 拆分产业日报与铜锂日报的钉钉推送时间：原先两者合并成一张卡、共用 send_time，
-- 而铜锂简报 16:00 才生成，send_time 在 16:00 之前时它永远进不了卡片。
-- 现在 send_time 只管产业日报，新增 briefing_send_time 只管铜锂日报。
--
-- 不在此处 UPDATE send_time —— 那是 admin 后台配置，代码发布不得覆盖
-- （同 scoring_config 的 ON CONFLICT DO NOTHING 约定）。产业日报改 09:00、
-- 铜锂日报改 17:00 由 admin 在后台调度表单里设置。
--
-- 默认值 '17:00' 只作用于 ADD COLUMN 时的既有行与新安装，不动 send_time。
--
-- ROLLBACK (manual only — do not auto-run):
--   ALTER TABLE daily_push_config DROP CONSTRAINT daily_push_config_briefing_send_time_check;
--   ALTER TABLE daily_push_config DROP COLUMN briefing_send_time;

BEGIN;

ALTER TABLE daily_push_config
  ADD COLUMN IF NOT EXISTS briefing_send_time TEXT NOT NULL DEFAULT '17:00';

-- 正则与 daily_push_config_send_time_check 保持逐字一致。
ALTER TABLE daily_push_config
  DROP CONSTRAINT IF EXISTS daily_push_config_briefing_send_time_check;
ALTER TABLE daily_push_config
  ADD CONSTRAINT daily_push_config_briefing_send_time_check
    CHECK (briefing_send_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$');

COMMIT;
