-- 0064_copilot.sql — v1.3 Copilot schema 与 copilot_app GRANT（spec/v1.3-copilot-agent/design.md §7）
-- CREATE ROLE 禁止写进本文件（sql.begin 事务内会 25001）：角色由 packages/db/scripts/migrate.ts
-- 在 runMigrations 之前非事务幂等创建（必须 LOGIN，默认 NOLOGIN 连不上）。密码步同在 migrate.ts
-- （runMigrations 成功后，COPILOT_APP_PASSWORD / COPILOT_APP_PASSWORD_FILE）。
-- 可见性单一来源：copilot.visible_items 视图（Python 工具 / worker fulltext / web cite 共用，禁止第三份谓词）。
-- 回滚：删 ledger 键 `0064_copilot.sql` 全名后手工 DROP SCHEMA copilot CASCADE + REASSIGN 角色归属。

BEGIN;

CREATE SCHEMA copilot;

CREATE TABLE copilot.sessions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES public.users(id),
  title           TEXT,
  source          TEXT NOT NULL CHECK (source IN ('ask', 'item')),
  item_id         BIGINT REFERENCES public.items(id) ON DELETE SET NULL,
  last_active     TIMESTAMPTZ NOT NULL DEFAULT now(),
  turn_locked_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- source='item' 时 item_id 在创建时由应用写入。
-- FK ON DELETE SET NULL：items 90 天清理不得与 CHECK 冲突（v1.0 陷阱 8）。
-- 列表遇到 source='item' AND item_id IS NULL：展示「原条目已过期」，仍可打开历史对话。
CREATE INDEX sessions_user_last_idx ON copilot.sessions (user_id, last_active DESC);

CREATE TABLE copilot.item_fulltext (
  item_id    BIGINT PRIMARY KEY REFERENCES public.items(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  truncated  BOOLEAN NOT NULL DEFAULT false,
  fetched_at TIMESTAMPTZ NOT NULL
);
-- 全文只经 worker（POSTGRES_USER）写、Python 经 worker HTTP 读：copilot_app 不 GRANT 本表。

CREATE TABLE copilot.messages (
  id         BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES copilot.sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  citations  JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_session_id_idx ON copilot.messages (session_id, id DESC);

CREATE TABLE copilot.audit_log (
  id                 BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES public.users(id),
  session_id         BIGINT REFERENCES copilot.sessions(id) ON DELETE SET NULL,
  message_id         BIGINT REFERENCES copilot.messages(id) ON DELETE SET NULL,
  tool_name          TEXT,
  args_preview       TEXT,
  result_preview     TEXT,
  result_row_count   INT,
  token_usage        JSONB,
  coverage           TEXT NOT NULL DEFAULT 'ok' CHECK (coverage IN ('none','ok')),
  aborted            BOOLEAN NOT NULL DEFAULT false,
  numbers_ungrounded INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_message_id_idx ON copilot.audit_log (message_id);

CREATE TABLE copilot.feedbacks (
  id         BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL REFERENCES copilot.messages(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES public.users(id),
  rating     SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE TABLE copilot.feature_flags (
  key        TEXT PRIMARY KEY,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  user_ids   BIGINT[] NOT NULL DEFAULT '{}',
  depts      TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES public.users(id)
);
-- 仅 feature_flags seed 允许 ON CONFLICT DO NOTHING（重跑 migration 不覆盖 admin 后台改动）。
INSERT INTO copilot.feature_flags (key, enabled) VALUES ('copilot', false)
  ON CONFLICT DO NOTHING;

-- 条目只经视图：禁止 copilot_app SELECT public.items / item_analysis / copilot.item_fulltext（漏谓词即泄密）。
GRANT USAGE ON SCHEMA public, copilot TO copilot_app;
GRANT SELECT ON public.item_entities, public.clusters, public.cluster_items,
  public.entities, public.daily_reports, public.commodity_quotes, public.entity_financials
  TO copilot_app;
GRANT SELECT, INSERT, UPDATE ON copilot.sessions TO copilot_app;  -- last_active / turn_locked_at
GRANT SELECT, INSERT ON copilot.messages TO copilot_app;          -- 禁止 UPDATE（防改历史回答）
GRANT SELECT, INSERT ON copilot.audit_log TO copilot_app;         -- 禁止 UPDATE
GRANT SELECT, INSERT, UPDATE ON copilot.feedbacks TO copilot_app; -- upsert
-- feature_flags 不 GRANT 给 copilot_app（灰度判定只在 web）；不 GRANT public.users、不 GRANT REFERENCES。

CREATE VIEW copilot.visible_items AS
SELECT items.id, items.title, items.content, items.url, items.source_id, items.published_at,
       item_analysis.summary_zh, item_analysis.scored_at, item_analysis.category,
       item_analysis.top_circle, item_analysis.quality_score, item_analysis.embedding,
       sources.name AS source_name, sources.fetcher_type
FROM items
JOIN sources ON sources.id = items.source_id
JOIN item_analysis ON item_analysis.item_id = items.id
LEFT JOIN cluster_items ON cluster_items.item_id = items.id
LEFT JOIN clusters ON clusters.id = cluster_items.cluster_id
WHERE item_analysis.scored_at IS NOT NULL
  AND item_analysis.quota_state NOT IN ('pending_over_quota','dropped_quota_expired','dropped_filter')
  AND (item_analysis.summary_zh IS NULL OR item_analysis.summary_zh <> '[需人工脱敏]')
  AND (clusters.id IS NULL OR clusters.lead_item_id = items.id)
  AND (
    item_analysis.is_industry_related IS NOT FALSE
    OR item_analysis.top_circle IN ('C1','C2')
    OR item_analysis.alert_type IN ('own','legal','risk')
  );
GRANT SELECT ON copilot.visible_items TO copilot_app;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA copilot TO copilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA copilot GRANT USAGE ON SEQUENCES TO copilot_app;
ALTER ROLE copilot_app SET statement_timeout = '5s';

COMMIT;
