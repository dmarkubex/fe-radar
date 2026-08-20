-- 0067_announcement_entity_filter.sql
-- T-UP-02: 给 source 9（巨潮资讯）/ 11（深交所披露）打开公司名前置过滤。
-- worker 在 config.entityFilter 缺省时视为不过滤（只上代码不上本 migration = 行为不变）。
-- 回滚：把 entityFilter.enabled 置回 false，过滤立即停摆，恢复全量入库。

BEGIN;

UPDATE sources
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{entityFilter}',
  COALESCE(
    config->'entityFilter',
    '{"enabled": true, "separators": [" ", "："]}'::jsonb
  ),
  true
)
WHERE id IN (9, 11)
  AND fetcher_type = 'announcement';

COMMIT;
