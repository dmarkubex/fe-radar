-- 0015_sources_rsshub_finance.sql
-- KYO-60: 财经/自媒体候选源 RSSHub 迁移（仅 fetcher_type=rss + 绝对 URL，无模板插值）
-- smoke 基准：自部署 RSSHub @ diygod/rsshub@sha256:0d40e1c9…（2026-05-27 本地 docker :1200）
-- 决策矩阵：docs/sources-rsshub-finance-matrix.md

BEGIN;

-- ============================================================
-- B 组：HTML → RSS（RSSHub 输出当普通 RSS）
-- 不改顶层 sources.url（0004 ON CONFLICT key；worker 读 config.url）
-- UPDATE WHERE name + 旧 url 保证幂等（可重复 pnpm migrate）
-- ============================================================

-- ✅ smoke 2026-05-27: /jiemian/lists/856 → 12 items（lists/55 在 RSSHub 503）
UPDATE sources
SET fetcher_type = 'rss',
    config       = '{"type":"rss","url":"http://rsshub:1200/jiemian/lists/856"}'::jsonb,
    enabled      = true
WHERE name = '界面新闻 能源'
  AND url  = 'https://www.jiemian.com/lists/55.html';

-- ✅ smoke 2026-05-27: /yicai/headline → 20 items（yicai.com/news/energy 已 404，无专属 route）
UPDATE sources
SET fetcher_type = 'rss',
    config       = '{"type":"rss","url":"http://rsshub:1200/yicai/headline"}'::jsonb,
    enabled      = true
WHERE name = '第一财经 能源'
  AND url  = 'https://www.yicai.com/news/energy/';

-- ✅ smoke 2026-05-27: /36kr/information/web_news → 30 items（search/新能源 仅 1 条）
UPDATE sources
SET fetcher_type = 'rss',
    config       = '{"type":"rss","url":"http://rsshub:1200/36kr/information/web_news"}'::jsonb,
    enabled      = true
WHERE name = '36氪 新能源'
  AND url  = 'https://36kr.com/information/web_news/';

-- ============================================================
-- C 组：评估后保持原 fetcher（记录于 decision matrix，不改协议）
-- ============================================================

-- ❌ RSSHub /cls/subject/1066 → 200 但 0 items；深度栏目非能源专题 → 保留 HTML
-- 财联社 能源：无变更

-- ❌ /xueqiu/*、/zhihu/topic/*、/163/* → 503 反爬/失效 → 雪球 playwright、知乎 disabled、网易 html
-- 钛媒体 /tmtpost/column/* smoke ≤1 → 保留 HTML
-- 电缆头条/储能头条 /wechat/sogou/* smoke ≤1 → 保留 Playwright

COMMIT;

-- Rollback (manual; top-level url unchanged):
-- UPDATE sources SET fetcher_type='html', config='{"type":"html","listUrl":"https://www.jiemian.com/lists/55.html","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb WHERE name='界面新闻 能源' AND url='https://www.jiemian.com/lists/55.html';
-- UPDATE sources SET fetcher_type='html', config='{"type":"html","listUrl":"https://www.yicai.com/news/energy/","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb WHERE name='第一财经 能源' AND url='https://www.yicai.com/news/energy/';
-- UPDATE sources SET fetcher_type='html', config='{"type":"html","listUrl":"https://36kr.com/information/web_news/","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb WHERE name='36氪 新能源' AND url='https://36kr.com/information/web_news/';
