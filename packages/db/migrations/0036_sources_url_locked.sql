-- 0036_sources_url_locked.sql
-- Give deployment-managed SMM quote sources a stable identity that survives admin URL edits.
--
-- migrate.ts replays 0027 before this file on every deploy. If an admin changed a seed URL,
-- 0027 inserts a fresh default-URL row before this reconciliation runs. We identify both the
-- old row and the replayed row by the existing smm-hq + metric_keys config fingerprint (with
-- the two seed URLs as a fallback), keep one canonical row, and disable later duplicates
-- without deleting rows that may already have foreign-key references.
--
-- Round 6 strategy (Finding 1 — admin-intent protection):
--   1. Canonical ranking prefers currently-enabled rows (post-0035 admin_snapshot restore),
--      then lowest id. An admin-enabled duplicate therefore becomes rank 1 and keeps enabled.
--   2. Non-canonical (rank > 1) rows are forced to enabled=false ONLY when
--      admin_snapshot does not contain an enabled key. Preserve the current enabled value only
--      when the admin explicitly changed enabled — never clobber a snapshot-restored enabled=true.
--   3. Every matched row still gets url_locked=true so future URL edits stay blocked.
--
-- Trade-off: if an admin deliberately enables two siblings, both can stay enabled until one
-- is turned off (dual-fetch risk). Admin UI badges + enable guards mitigate that path.
--
-- Known limitation: this assumes an admin URL edit did not also replace the smm-hq adapter or
-- its cu_main_close/lc_main_close metric key. If both URL and config lost that fingerprint, the
-- historical row cannot be distinguished reliably from an unrelated source and remains unlocked.

BEGIN;

ALTER TABLE sources
ADD COLUMN IF NOT EXISTS url_locked BOOLEAN NOT NULL DEFAULT false;

WITH candidates AS (
  SELECT
    id,
    enabled,
    admin_snapshot,
    CASE
      WHEN (config->'metric_keys') ? 'cu_main_close'
        OR url = 'https://hq.smm.cn/h5/cu'
        THEN 'cu'
      WHEN (config->'metric_keys') ? 'lc_main_close'
        OR url = 'https://hq.smm.cn/h5/Li2CO3'
        THEN 'lc'
    END AS logical_source
  FROM sources
  WHERE (
    (
      fetcher_type = 'quotes'
      AND config->>'adapter' = 'smm-hq'
      AND (config->'metric_keys') ?| ARRAY['cu_main_close', 'lc_main_close']
    )
    OR url IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3')
  )
), ranked AS (
  SELECT
    id,
    enabled,
    admin_snapshot,
    ROW_NUMBER() OVER (
      PARTITION BY logical_source
      ORDER BY
        CASE WHEN enabled THEN 0 ELSE 1 END,
        id ASC
    ) AS source_rank
  FROM candidates
  WHERE logical_source IS NOT NULL
)
UPDATE sources AS source
SET url_locked = true,
    enabled = CASE
      WHEN ranked.source_rank = 1 THEN source.enabled
      WHEN ranked.admin_snapshot ? 'enabled' THEN source.enabled
      ELSE false
    END
FROM ranked
WHERE source.id = ranked.id;

COMMIT;

-- Rollback (manual only): ALTER TABLE sources DROP COLUMN IF EXISTS url_locked;
