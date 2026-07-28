-- 0039_nea_news_json_adapter.sql
-- The historical /xwzx/zyxw.htm URL is 404. The current /xwzx/nyyw.htm page renders from
-- a public same-origin ds_*.json file (verified 2026-07-27: HTTP 200, 1000 records).
--
-- Keep the source disabled until the deployment network runs a >=3 item smoke. This migration
-- prepares the stable API adapter without claiming that the production proxy path was verified.
--
-- Deliberate narrow exception to the normal admin_snapshot/admin_touched_at migration guard:
-- this is a safety-disable migration, so the final UPDATE must override an admin-set
-- enabled=true until the production-path smoke passes. Admin-owned config remains protected;
-- only the enabled state, fail count, and explanatory last_error are forced.

BEGIN;

UPDATE sources
SET url = 'https://www.nea.gov.cn/xwzx/nyyw.htm',
    fetcher_type = 'announcement',
    config = '{
      "type": "announcement",
      "adapter": "nea-news",
      "endpoint": "https://www.nea.gov.cn/xwzx/ds_8839d76f7cb542ca8cbaab7122cc9b83.json",
      "pageSize": 50,
      "useRealUa": true
    }'::jsonb,
    enabled = false
WHERE name = '国家能源局'
  AND url IN (
    'https://www.nea.gov.cn/xwzx/zyxw.htm',
    'https://www.nea.gov.cn/xwzx/index.htm'
  )
  AND NOT COALESCE(admin_snapshot ? 'config', false);

UPDATE sources
SET enabled = false,
    fail_count = 0,
    -- last_error_at left untouched on purpose (same rule as 0040/0041): it records the real last
    -- fetch failure, and this migration is a review decision rather than a new failure event.
    last_error = '2026-07-27 复核：国家能源局 JSON adapter 已适配；待部署网络 smoke >=3 条后启用'
WHERE url IN (
  'https://www.nea.gov.cn/xwzx/zyxw.htm',
  'https://www.nea.gov.cn/xwzx/index.htm',
  'https://www.nea.gov.cn/xwzx/nyyw.htm'
);

DO $$ BEGIN
  RAISE NOTICE '0039 NEA safety-disable result: disabled_rows=%, admin_touched_rows=%',
    (SELECT count(*) FROM sources
      WHERE url IN (
        'https://www.nea.gov.cn/xwzx/zyxw.htm',
        'https://www.nea.gov.cn/xwzx/index.htm',
        'https://www.nea.gov.cn/xwzx/nyyw.htm'
      )
      AND enabled = false
      AND last_error = '2026-07-27 复核：国家能源局 JSON adapter 已适配；待部署网络 smoke >=3 条后启用'),
    (SELECT count(*) FROM sources
      WHERE url IN (
        'https://www.nea.gov.cn/xwzx/zyxw.htm',
        'https://www.nea.gov.cn/xwzx/index.htm',
        'https://www.nea.gov.cn/xwzx/nyyw.htm'
      )
      AND admin_touched_at IS NOT NULL
      AND enabled = false
      AND last_error = '2026-07-27 复核：国家能源局 JSON adapter 已适配；待部署网络 smoke >=3 条后启用');
END $$;

COMMIT;

-- Rollback (manual):
-- UPDATE sources
-- SET url='https://www.nea.gov.cn/xwzx/zyxw.htm',
--     fetcher_type='html',
--     config='{"type":"html","listUrl":"https://www.nea.gov.cn/xwzx/zyxw.htm","useRealUa":true,"selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
--     enabled=false
-- WHERE name='国家能源局'
--   AND url='https://www.nea.gov.cn/xwzx/nyyw.htm';
