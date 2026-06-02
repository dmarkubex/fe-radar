-- ===========================================================================
-- 0008_commodity_briefing.down.sql — reverse migration for T-CB-02a
-- Reverses 0008_commodity_briefing.sql:
--   1. Drops the 6 commodity-briefing tables (FK-safe reverse order)
--   2. Restores sources.fetcher_type CHECK to the original 3-value set
-- Idempotent: safe to run more than once. Apply manually for an explicit
-- rollback (migrate.ts only auto-applies forward .sql migrations).
-- ===========================================================================

BEGIN;

-- 1. Drop the 6 new tables (order matters for FK constraints)
DROP TABLE IF EXISTS briefing_template_fields;
DROP TABLE IF EXISTS briefing_holidays;
DROP TABLE IF EXISTS briefing_pushes;
DROP TABLE IF EXISTS briefing_targets;
DROP TABLE IF EXISTS commodity_briefings;
DROP TABLE IF EXISTS commodity_quotes;

-- 2. Restore sources.fetcher_type CHECK to original 3-value set
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sources_fetcher_type_check'
      AND conrelid = 'sources'::regclass
  ) THEN
    ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check;
  END IF;

  ALTER TABLE sources
    ADD CONSTRAINT sources_fetcher_type_check
    CHECK (fetcher_type IN ('rss', 'html', 'playwright'));
END
$$;

COMMIT;
