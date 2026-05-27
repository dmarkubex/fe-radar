-- Migration 0012: announcement fetcher type
-- Extends: sources.fetcher_type CHECK to include 'announcement'
-- Rollback: restore the current rss/html/playwright/quotes set

BEGIN;

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
    CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement'));
END
$$;

COMMIT;

-- ===========================================================================
-- ROLLBACK SQL（reference only — do NOT auto-exec）
-- Run manually to revert this migration if needed.
-- ===========================================================================
/*
BEGIN;

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
    CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes'));
END
$$;

COMMIT;
*/
