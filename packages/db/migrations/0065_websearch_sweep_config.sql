-- 0065_websearch_sweep_config.sql
-- T-UP-01: source 148（豆包搜索-企业重大动态）写入 sweep 兜底配置。
-- worker 在 config.sweep 缺省时视为 enabled=false（只上代码不上本 migration = 行为不变）。
-- 回滚：UPDATE sources SET config = jsonb_set(config, '{sweep,enabled}', 'false'::jsonb) WHERE id = 148;

BEGIN;

UPDATE sources
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{sweep}',
  COALESCE(
    config->'sweep',
    '{"enabled": true, "maxPerRun": 14, "circles": ["C1", "C2"]}'::jsonb
  ),
  true
)
WHERE id = 148
  AND fetcher_type = 'websearch';

COMMIT;
