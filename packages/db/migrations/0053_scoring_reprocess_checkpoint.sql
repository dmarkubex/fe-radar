-- 0053_scoring_reprocess_checkpoint.sql
-- 评分历史重算固定目标与续跑 checkpoint；不复制 item 正文或评分结果。
-- 回滚：仅在无重算进程运行时删除 targets，再删除 runs。

BEGIN;

CREATE TABLE IF NOT EXISTS scoring_reprocess_runs (
  run_id       TEXT PRIMARY KEY,
  from_at      TIMESTAMPTZ NOT NULL,
  until_at     TIMESTAMPTZ NOT NULL,
  status       TEXT NOT NULL DEFAULT 'prepared'
               CHECK (status IN ('prepared', 'running', 'completed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (from_at < until_at)
);

CREATE INDEX IF NOT EXISTS scoring_reprocess_runs_status_created_idx
  ON scoring_reprocess_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS scoring_reprocess_targets (
  run_id     TEXT NOT NULL REFERENCES scoring_reprocess_runs(run_id) ON DELETE CASCADE,
  item_id    BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped_filter', 'pending_quota')),
  attempts   INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, item_id)
);

CREATE INDEX IF NOT EXISTS scoring_reprocess_targets_run_status_updated_idx
  ON scoring_reprocess_targets (run_id, status, updated_at);

CREATE INDEX IF NOT EXISTS scoring_reprocess_targets_item_idx
  ON scoring_reprocess_targets (item_id);

COMMIT;
