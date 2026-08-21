-- 0069_websearch_max_age.sql
-- source 148（豆包搜索-企业重大动态）补 Gate 0 maxAgeHours=48。
-- 仅当 gate0.maxAgeHours 缺失时写入，重跑不覆盖 admin 已设值。
-- 回滚：UPDATE sources SET config = config #- '{gate0,maxAgeHours}' WHERE id = 148 AND fetcher_type = 'websearch';

BEGIN;

UPDATE sources
SET config = jsonb_set(
  jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{gate0}',
    COALESCE(config->'gate0', '{}'::jsonb),
    true
  ),
  '{gate0,maxAgeHours}',
  COALESCE(config #> '{gate0,maxAgeHours}', '48'::jsonb),
  true
)
WHERE id = 148
  AND fetcher_type = 'websearch';

COMMIT;
