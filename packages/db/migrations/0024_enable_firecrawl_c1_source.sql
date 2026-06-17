-- 0024_enable_firecrawl_c1_source.sql
-- 启用 Firecrawl C1 风险检索信源（需部署侧配置 FIRECRAWL_API_KEY / secret）。
-- 未配置 key 时 worker 抓取会失败，fail_count 递增；admin 可再关 enabled。

BEGIN;

UPDATE sources
SET enabled    = true,
    fail_count = 0,
    last_error = NULL
WHERE name = 'Firecrawl-C1风险检索'
  AND fetcher_type = 'crawl';

COMMIT;

-- Rollback: UPDATE sources SET enabled = false WHERE name = 'Firecrawl-C1风险检索';
