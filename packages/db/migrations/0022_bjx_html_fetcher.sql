-- 0022_bjx_html_fetcher.sql
-- 北极星站群 2026 首页改版：.news-list 已移除，Playwright 30s 等不到元素。
-- 多数垂直子站（储能/输配电/风电/售电）静态 HTML + 真实 UA 可直连；
-- news.bjx.com.cn / guangfu.bjx.com.cn 对机房 IP 易触发 Aliyun WAF → 改抓 www.bjx.com.cn 聚合列表。
-- 幂等：仅当仍为旧 Playwright + .news-list 配置时更新，不覆盖 admin 手工改过的信源。
--
-- 已发布迁移合法例外（2026-07-28）：旧版把下列两个 sources.url 都改成 www.bjx.com.cn，
-- 会违反 url UNIQUE，让全新库永久停在 0022；生产 0001–0037 仅由 MIGRATION_BASELINE
-- 记账、从未执行本 SQL，因此也没有可在 0023+ 补救的前向路径。这里保留 0011 的唯一
-- source URL，只把共享抓取入口写入 config.listUrl；migrate.ts 仅兼容此次旧/新校验和对。

BEGIN;

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://www.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li a[href*=\"news.bjx.com.cn/html\"]","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星电力新闻网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://chuneng.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星储能网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://shupeidian.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星输配电网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://www.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li a[href*=\"guangfu.bjx.com.cn\"]","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星太阳能光伏网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://fd.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星风力发电网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://shoudian.bjx.com.cn/","useRealUa":true,"selectors":{"item":".cc-ul-dot li","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '北极星售电网'
  AND fetcher_type = 'playwright'
  AND config->>'waitFor' = '.news-list';

COMMIT;
