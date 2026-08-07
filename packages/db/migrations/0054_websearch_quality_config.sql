-- 0054_websearch_quality_config.sql
-- 豆包搜索改为企业重大动态单句检索；新增字段仅在缺失时补齐，不覆盖后台已有值。
-- 回滚：删除下列新增 config key，并将精确匹配的新名称恢复为“豆包搜索-突发新闻”。

BEGIN;

UPDATE sources
SET
  name = CASE
    WHEN name = '豆包搜索-突发新闻' THEN '豆包搜索-企业重大动态'
    ELSE name
  END,
  config = jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          config,
          '{queryTopics}',
          COALESCE(
            config->'queryTopics',
            '["中标","招标","订单","重大项目","扩产投产","事故处罚","诉讼","并购重组","业绩"]'::jsonb
          ),
          true
        ),
        '{maxAliases}',
        COALESCE(config->'maxAliases', '1'::jsonb),
        true
      ),
      '{needUrl}',
      COALESCE(config->'needUrl', 'true'::jsonb),
      true
    ),
    '{queryRewrite}',
    COALESCE(config->'queryRewrite', 'true'::jsonb),
    true
  )
WHERE fetcher_type = 'websearch'
  AND url = 'https://open.feedcoopapi.com/search_api/web_search';

COMMIT;
