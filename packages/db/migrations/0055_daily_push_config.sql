-- 0055_daily_push_config.sql
-- 钉钉合并日报推送：调度单例配置 + 按日/目标审计表。
-- 默认 enabled=false，迁移本身不向任何群发送消息。
--
-- ROLLBACK (manual only — do not auto-run):
--   DROP TABLE IF EXISTS daily_pushes;
--   DROP TABLE IF EXISTS daily_push_config;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. daily_push_config — singleton (id must be 1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_push_config (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  send_time     TEXT NOT NULL DEFAULT '16:15',
  schedule_mode TEXT NOT NULL DEFAULT 'business_days',
  base_url      TEXT NOT NULL DEFAULT 'http://fe-radar.internal',
  updated_by    BIGINT NULL REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT daily_push_config_send_time_check
    CHECK (send_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT daily_push_config_schedule_mode_check
    CHECK (schedule_mode IN ('daily', 'business_days'))
);

INSERT INTO daily_push_config (id, enabled, send_time, schedule_mode, base_url)
VALUES (1, FALSE, '16:15', 'business_days', 'http://fe-radar.internal')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. daily_pushes — per-date / per-target audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_pushes (
  id                   BIGSERIAL PRIMARY KEY,
  report_date          DATE NOT NULL,
  target_id            BIGINT NOT NULL REFERENCES briefing_targets(id),
  briefing_id          BIGINT NULL REFERENCES commodity_briefings(id) ON DELETE SET NULL,
  daily_report_present BOOLEAN NOT NULL,
  briefing_present     BOOLEAN NOT NULL,
  push_status          TEXT NOT NULL,
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  error_detail         TEXT,
  pushed_at            TIMESTAMPTZ,
  CONSTRAINT daily_pushes_push_status_check
    CHECK (push_status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT daily_pushes_report_date_target_key
    UNIQUE (report_date, target_id)
);

CREATE INDEX IF NOT EXISTS daily_pushes_status_idx
  ON daily_pushes (push_status, pushed_at);

CREATE INDEX IF NOT EXISTS daily_pushes_report_date_idx
  ON daily_pushes (report_date);

COMMIT;
