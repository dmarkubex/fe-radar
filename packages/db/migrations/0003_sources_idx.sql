DO $$ BEGIN
  ALTER TABLE sources ADD CONSTRAINT sources_url_key UNIQUE (url);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS sources_enabled_tier_idx ON sources (enabled, tier);
CREATE INDEX IF NOT EXISTS sources_category_idx ON sources (category);
CREATE INDEX IF NOT EXISTS sources_last_ok_at_idx ON sources (last_ok_at);
CREATE INDEX IF NOT EXISTS sources_fail_count_idx ON sources (fail_count);
