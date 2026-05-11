ALTER TABLE sources ADD CONSTRAINT sources_url_key UNIQUE (url);

CREATE INDEX sources_enabled_tier_idx ON sources (enabled, tier);
CREATE INDEX sources_category_idx ON sources (category);
CREATE INDEX sources_last_ok_at_idx ON sources (last_ok_at);
CREATE INDEX sources_fail_count_idx ON sources (fail_count);
