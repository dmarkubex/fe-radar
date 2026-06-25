-- 0028_entity_financials_and_datapro_type.sql
-- T-ARK-01: 新增 entity_financials 表（实体财务指标时序）+ sources.fetcher_type 扩展 'datapro'
-- entity_financials 不在 90 天保留清单内 → 永久保留（cleanup job 不涉及）

BEGIN;

-- 1. 扩展 sources.fetcher_type CHECK：追加 'datapro'
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
    CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl', 'datapro'));
END
$$;

-- 2. 创建 entity_financials 表
CREATE TABLE IF NOT EXISTS entity_financials (
  id          bigserial PRIMARY KEY,
  entity_id   bigint NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  metric      text NOT NULL,
  value       numeric(20, 4),
  period      text NOT NULL,
  observed_at timestamptz,
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. UNIQUE(entity_id, metric, period)
CREATE UNIQUE INDEX IF NOT EXISTS entity_financials_entity_metric_period_key
  ON entity_financials (entity_id, metric, period);

-- 4. 索引：entity_id + observed_at DESC
CREATE INDEX IF NOT EXISTS entity_financials_entity_observed_idx
  ON entity_financials (entity_id, observed_at DESC);

COMMIT;

-- Rollback:
-- DROP TABLE IF EXISTS entity_financials;
-- ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check;
-- ALTER TABLE sources ADD CONSTRAINT sources_fetcher_type_check
--   CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl'));
