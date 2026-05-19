-- Migration 0008: commodity briefing tables + sources.fetcher_type extension
-- Extends: sources.fetcher_type CHECK to include 'quotes'
-- Creates:  commodity_quotes / commodity_briefings / briefing_targets /
--           briefing_pushes / briefing_holidays / briefing_template_fields
-- Idempotent: all CREATE TABLE use IF NOT EXISTS; CHECK replacement uses DO block

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend sources.fetcher_type CHECK to include 'quotes'
--    PostgreSQL auto-names inline column CHECK as {table}_{col}_check.
--    Use DO block to handle cases where constraint may or may not exist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Drop the old constraint if it exists (covers both explicit and auto-named)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sources_fetcher_type_check'
      AND conrelid = 'sources'::regclass
  ) THEN
    ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check;
  END IF;

  -- Add the new constraint with 'quotes' included
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sources_fetcher_type_check'
      AND conrelid = 'sources'::regclass
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_fetcher_type_check
      CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes'));
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. commodity_quotes
--    大宗商品时序数值（NFR-103：保留 365 天）
--    UNIQUE (metric_key, observed_at) guards against duplicate ingestion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commodity_quotes (
  id           BIGSERIAL PRIMARY KEY,
  metric_key   TEXT NOT NULL,
  value        NUMERIC(18, 4),
  change_pct   NUMERIC(8, 4),
  source_id    BIGINT NOT NULL REFERENCES sources(id),
  raw_text     TEXT,
  observed_at  TIMESTAMPTZ NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commodity_quotes_metric_observed_key UNIQUE (metric_key, observed_at)
);

CREATE INDEX IF NOT EXISTS commodity_quotes_metric_observed_idx
  ON commodity_quotes (metric_key, observed_at);

-- ---------------------------------------------------------------------------
-- 3. commodity_briefings
--    简报记录（NFR-103：元数据 90 天，docx 文件随 MinIO retention）
--    template_version: v0.4 M1 fix — 关联 design/templates/briefing.docx 版本号
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS commodity_briefings (
  id               BIGSERIAL PRIMARY KEY,
  briefing_date    DATE NOT NULL UNIQUE,
  template_version INTEGER NOT NULL DEFAULT 1,
  payload_json     JSONB NOT NULL,
  docx_path        TEXT,
  gen_status       TEXT NOT NULL,
  gen_error        TEXT,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commodity_briefings_gen_status_check
    CHECK (gen_status IN ('pending', 'succeeded', 'failed', 'degraded'))
);

CREATE INDEX IF NOT EXISTS commodity_briefings_date_idx
  ON commodity_briefings (briefing_date);

CREATE INDEX IF NOT EXISTS commodity_briefings_tpl_version_idx
  ON commodity_briefings (template_version);

-- ---------------------------------------------------------------------------
-- 4. briefing_targets
--    推送目标（admin 后台维护）
--    disabled_at: v0.4 M2 fix — 软删时间戳；管理后台"删除" = UPDATE disabled_at=now() + enabled=false
--    Partial index on active targets only (WHERE disabled_at IS NULL)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefing_targets (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  channel      TEXT NOT NULL,
  webhook_url  TEXT NOT NULL,
  sign_secret  TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  disabled_at  TIMESTAMPTZ,
  created_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT briefing_targets_channel_check
    CHECK (channel IN ('dingtalk_bot'))
);

-- Partial index: active targets only (v0.4 fix M2)
CREATE INDEX IF NOT EXISTS briefing_targets_active_idx
  ON briefing_targets (id)
  WHERE disabled_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. briefing_pushes
--    推送记录；both FK ON DELETE CASCADE to preserve audit chain
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefing_pushes (
  id            BIGSERIAL PRIMARY KEY,
  briefing_id   BIGINT NOT NULL REFERENCES commodity_briefings(id) ON DELETE CASCADE,
  target_id     BIGINT NOT NULL REFERENCES briefing_targets(id) ON DELETE CASCADE,
  push_status   TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_detail  TEXT,
  pushed_at     TIMESTAMPTZ,
  CONSTRAINT briefing_pushes_push_status_check
    CHECK (push_status IN ('pending', 'succeeded', 'failed')),
  CONSTRAINT briefing_pushes_briefing_target_key
    UNIQUE (briefing_id, target_id)
);

CREATE INDEX IF NOT EXISTS briefing_pushes_status_idx
  ON briefing_pushes (push_status, pushed_at);

-- ---------------------------------------------------------------------------
-- 6. briefing_holidays
--    节假日表（admin 一年一次维护）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefing_holidays (
  holiday_date  DATE PRIMARY KEY,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 7. briefing_template_fields
--    模板字段映射（NFR-107：admin 可后台改）
--    exactly_one_source CHECK: source_metric XOR llm_path XOR neither (static placeholder)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS briefing_template_fields (
  placeholder_key  TEXT PRIMARY KEY,
  label            TEXT NOT NULL,
  source_metric    TEXT,
  llm_path         TEXT,
  fallback_text    TEXT NOT NULL DEFAULT '—',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT briefing_template_fields_exactly_one_source_check CHECK (
    (source_metric IS NOT NULL AND llm_path IS NULL)
    OR (source_metric IS NULL AND llm_path IS NOT NULL)
    OR (source_metric IS NULL AND llm_path IS NULL)
  )
);

COMMIT;

-- ===========================================================================
-- ROLLBACK SQL（reference only — do NOT auto-exec）
-- Run manually to revert this migration if needed.
-- ===========================================================================
/*
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
*/
