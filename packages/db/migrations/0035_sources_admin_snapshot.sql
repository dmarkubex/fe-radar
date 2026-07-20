-- 0035_sources_admin_snapshot.sql
-- Protect future admin edits from historical seed migrations that are replayed on every deploy.
--
-- 0027 unconditionally restores the two SMM source rows to enabled=true and replaces config before
-- later migrations run. admin_touched_at only proves that an admin changed a row; it cannot say
-- whether the intended enabled value was true or false, and the current value is already overwritten
-- by 0027 at this point. Therefore an unconditional disable based only on admin_touched_at would break
-- the valid workflow where an admin deliberately enables a quotes source.
--
-- admin_snapshot preserves only enabled/config values explicitly supplied through updateSource().
-- This migration replays each preserved key independently and only when its current value differs,
-- so the full migration set can safely rerun without repeated writes.
--
-- Known limitation: admin_touched_at/admin_snapshot are NULL for admin edits made before these columns
-- and the updated application code were deployed. Those historical intentions cannot be reconstructed;
-- this migration protects only future admin edits.

BEGIN;

ALTER TABLE sources
ADD COLUMN IF NOT EXISTS admin_snapshot JSONB;

UPDATE sources
SET enabled = COALESCE((admin_snapshot->>'enabled')::boolean, enabled),
    config = COALESCE(admin_snapshot->'config', config)
WHERE admin_touched_at IS NOT NULL
  AND admin_snapshot IS NOT NULL
  AND (
    (admin_snapshot ? 'enabled' AND enabled IS DISTINCT FROM (admin_snapshot->>'enabled')::boolean)
    OR (admin_snapshot ? 'config' AND config IS DISTINCT FROM (admin_snapshot->'config'))
  );

COMMIT;

-- Rollback (manual only): ALTER TABLE sources DROP COLUMN IF EXISTS admin_snapshot;
