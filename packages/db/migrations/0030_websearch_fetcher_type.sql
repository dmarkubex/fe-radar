-- 0030_websearch_fetcher_type.sql
-- v1.2 火山方舟 Agent Plan Harness — 豆包搜索 fetcher_type + seed
-- 依赖 0028（fetcher_type CHECK 已含 'datapro'）

BEGIN;

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
    CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl', 'datapro', 'websearch'));
END
$$;

-- 豆包搜索源（T3）— NER 事件驱动，不进 6h 定时周期
INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    ('豆包搜索-突发新闻',
     'https://open.feedcoopapi.com/search_api/web_search',
     'websearch',
     '{
       "type": "websearch",
       "timeRange": "OneWeek",
       "count": 10,
       "authInfoLevel": 0
     }'::jsonb,
     'T3', '突发新闻', true)

-- 仅首次初始化；admin 后台修改不被 reseed 覆盖。
-- enabled=true 但不进定时周期（scheduler 排除 websearch type），仅由 NER 事件驱动 enqueue。
ON CONFLICT (url) DO NOTHING;

COMMIT;

-- 部署后：在 Portainer 配置 WEBSEARCH_API_KEY
