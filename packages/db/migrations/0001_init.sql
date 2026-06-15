CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS zhparser;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'zhparser') THEN
    CREATE TEXT SEARCH CONFIGURATION zhparser (PARSER = zhparser);
    ALTER TEXT SEARCH CONFIGURATION zhparser ADD MAPPING FOR n,v,a,i,e,l WITH simple;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sources (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  fetcher_type TEXT NOT NULL CHECK (fetcher_type IN ('rss','html','playwright')),
  config       JSONB NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('T1','T2','T3')),
  category     TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_ok_at   TIMESTAMPTZ,
  fail_count   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  id             BIGSERIAL PRIMARY KEY,
  type           TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  circle         TEXT CHECK (circle IN ('C1','C2','C3')),
  weight         REAL NOT NULL DEFAULT 1.0,
  meta           JSONB,
  UNIQUE (type, canonical_name)
);
CREATE INDEX IF NOT EXISTS entities_aliases_gin ON entities USING gin (aliases);

CREATE TABLE IF NOT EXISTS items (
  id            BIGSERIAL PRIMARY KEY,
  source_id     BIGINT NOT NULL REFERENCES sources(id),
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  content       TEXT,
  lang          TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS items_published_at_idx ON items (published_at DESC);
CREATE INDEX IF NOT EXISTS items_fts_idx ON items USING gin (
  to_tsvector('zhparser', coalesce(title,'') || ' ' || coalesce(content,''))
);

CREATE TABLE IF NOT EXISTS item_analysis (
  item_id              BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  is_industry_related  BOOLEAN,
  summary_zh           TEXT,
  translation_zh       TEXT,
  d1_policy            REAL,
  d2_chain             REAL,
  d3_market            REAL,
  d4_tech              REAL,
  d5_business          REAL,
  quality_score        REAL,
  category             TEXT,
  top_circle           TEXT,
  is_curated           BOOLEAN NOT NULL DEFAULT FALSE,
  alert_level          TEXT,
  alert_type           TEXT,
  quota_state          TEXT CHECK (quota_state IN ('admitted','pending_over_quota','dropped_quota_expired','dropped_filter')) DEFAULT 'admitted',
  embedding            vector(1024),
  scored_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS analysis_quality_idx ON item_analysis (quality_score DESC) WHERE is_curated;
CREATE INDEX IF NOT EXISTS analysis_emb_idx ON item_analysis USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS item_entities (
  item_id   BIGINT REFERENCES items(id) ON DELETE CASCADE,
  entity_id BIGINT REFERENCES entities(id),
  span      TEXT,
  PRIMARY KEY (item_id, entity_id)
);

CREATE TABLE IF NOT EXISTS clusters (
  id            BIGSERIAL PRIMARY KEY,
  centroid      vector(1024),
  lead_item_id  BIGINT REFERENCES items(id) ON DELETE SET NULL,
  event_type    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cluster_items (
  cluster_id BIGINT REFERENCES clusters(id) ON DELETE CASCADE,
  item_id    BIGINT REFERENCES items(id) ON DELETE CASCADE,
  similarity REAL,
  PRIMARY KEY (cluster_id, item_id)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  date         DATE PRIMARY KEY,
  sections     JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                    BIGSERIAL PRIMARY KEY,
  username              TEXT UNIQUE,
  password_hash         TEXT,
  dingtalk_id           TEXT UNIQUE,
  name                  TEXT NOT NULL,
  dept                  TEXT,
  role                  TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','editor','admin')),
  merged_at             TIMESTAMPTZ,
  merged_from_user_id   BIGINT REFERENCES users(id),
  disabled_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (username IS NOT NULL AND password_hash IS NOT NULL)
    OR dingtalk_id IS NOT NULL
  )
);
CREATE INDEX IF NOT EXISTS users_active_idx ON users (id) WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS merge_conflicts (
  id              BIGSERIAL PRIMARY KEY,
  unionid         TEXT NOT NULL,
  name            TEXT NOT NULL,
  dept            TEXT,
  candidate_ids   BIGINT[] NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  resolved_by     BIGINT REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS merge_conflicts_status_idx ON merge_conflicts (status, created_at DESC);

CREATE TABLE IF NOT EXISTS feedbacks (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT REFERENCES items(id) ON DELETE CASCADE,
  user_id     BIGINT REFERENCES users(id),
  vote        SMALLINT CHECK (vote IN (-1, 0, 1)),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scoring_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);
