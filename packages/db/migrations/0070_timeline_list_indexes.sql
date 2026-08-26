-- 0070_timeline_list_indexes.sql
-- T-PERF-03: timeline / alerts / curated list JOIN cluster_items ON item_id
-- (PK is (cluster_id, item_id), so that join was a seq scan). scored_at
-- supports keyset pagination and 24h alert windows.
--
-- ROLLBACK (manual only — do not auto-run):
--   DROP INDEX IF EXISTS cluster_items_item_id_idx;
--   DROP INDEX IF EXISTS analysis_scored_at_idx;

BEGIN;

CREATE INDEX IF NOT EXISTS cluster_items_item_id_idx
  ON cluster_items (item_id);

CREATE INDEX IF NOT EXISTS analysis_scored_at_idx
  ON item_analysis (scored_at DESC)
  WHERE scored_at IS NOT NULL;

ANALYZE items;
ANALYZE item_analysis;
ANALYZE cluster_items;
ANALYZE clusters;

COMMIT;
