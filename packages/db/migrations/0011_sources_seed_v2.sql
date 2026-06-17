-- 0011_sources_seed_v2.sql
-- 用途：将 2026-05-12 可达性验证结果应用到所有环境（v2 seed）
-- 验证日期：2026-05-12
-- 对应任务：sources seed v2 — 修正 enabled / selectors / fetcher_type / url
-- 编号：0008/0009/0010 已被 v1.1 commodity_briefing schema 预留（见 spec/v1.1-commodity-briefing/tasks.md T-CB-02a + DMA-50/DMA-156 plan），seed v2 放 0011
-- 策略：
--   B 组（URL 变更）：UPDATE WHERE name=... AND url=<旧 url>，先改 url 再做后续操作
--   A 组（URL 不变）：INSERT ... ON CONFLICT (url) DO NOTHING，避免重跑覆盖 admin 后台配置
-- Migration runner 按文件名去重，0011 仅执行一次；ON CONFLICT / WHERE 双重防御保证幂等

BEGIN;

-- ============================================================
-- B 组：URL 变更 — 北极星系列 RSS → Playwright list 页
--   所有北极星站点均走 Aliyun WAF JS challenge，RSS 已失效，
--   切换为 Playwright 抓取列表页。
--   UPDATE WHERE name=... AND url=<旧 url> 保证幂等性。
-- ============================================================

-- 北极星电力新闻网：rss.xml → news.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://news.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://news.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星电力新闻网'
  AND url  = 'https://news.bjx.com.cn/rss.xml';

-- 北极星储能网：rss.xml → chuneng.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://chuneng.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://chuneng.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星储能网'
  AND url  = 'https://chuneng.bjx.com.cn/rss.xml';

-- 北极星输配电网：rss.xml → shupeidian.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://shupeidian.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://shupeidian.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星输配电网'
  AND url  = 'https://shupeidian.bjx.com.cn/rss.xml';

-- 北极星太阳能光伏网：rss.xml → guangfu.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://guangfu.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://guangfu.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星太阳能光伏网'
  AND url  = 'https://guangfu.bjx.com.cn/rss.xml';

-- 北极星风力发电网：bjxfd zt 页 → fd.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://fd.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://fd.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星风力发电网'
  AND url  = 'https://news.bjx.com.cn/zt/bjxfd/';

-- 北极星智能电网在线：rss.xml → smartgrid.bjx.com.cn/ (Playwright, disabled)  -- ❌ verify 2026-05-12: SSL handshake fail
UPDATE sources
SET url          = 'https://smartgrid.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://smartgrid.bjx.com.cn/","waitFor":"body","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = false
WHERE name = '北极星智能电网在线'
  AND url  = 'https://smartgrid.bjx.com.cn/rss.xml';

-- 北极星售电网：rss.xml → shoudian.bjx.com.cn/ (Playwright)  -- ✅ 200 JS challenge
UPDATE sources
SET url          = 'https://shoudian.bjx.com.cn/',
    fetcher_type = 'playwright',
    config       = '{"type":"playwright","listUrl":"https://shoudian.bjx.com.cn/","waitFor":".news-list","useRealUa":true,"extractor":"() => Array.from(document.querySelectorAll(''.news-list li a'')).slice(0,20).map(a => ({ title: a.textContent.trim(), url: a.href }))"}'::jsonb,
    enabled      = true
WHERE name = '北极星售电网'
  AND url  = 'https://shoudian.bjx.com.cn/rss.xml';

-- ============================================================
-- A 组：URL 不变，仅调 enabled / config / selectors / fetcher_type
--   使用 INSERT ... ON CONFLICT (url) DO NOTHING；
--   已存在源的修复必须走显式 backfill migration，保留 admin 手工配置。
-- ============================================================

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    -- ❌ verify 2026-05-12: 404 — 国家能源局新闻中心已改版，此 URL 不可达
    ('国家能源局',
     'https://www.nea.gov.cn/xwzx/zyxw.htm',
     'html',
     '{"type":"html","listUrl":"https://www.nea.gov.cn/xwzx/zyxw.htm","useRealUa":true,"selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '政府', false),

    -- ✅ verify 2026-05-12: 200 11KB — 修正 selectors.item 为 ul.u-list > li
    ('国家发改委',
     'https://www.ndrc.gov.cn/xwdt/xwfb/',
     'html',
     '{"type":"html","listUrl":"https://www.ndrc.gov.cn/xwdt/xwfb/","useRealUa":true,"selectors":{"item":"ul.u-list > li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '政府', true),

    -- ✅ verify 2026-05-12: 200 499KB WordPress — 修正 selectors.item 为 article.et-item，date 为 time
    ('中关村储能产业技术联盟 CNESA',
     'http://www.cnesa.org/index/news',
     'html',
     '{"type":"html","listUrl":"http://www.cnesa.org/index/news","selectors":{"item":"article.et-item","title":"a","link":"a","date":"time"}}'::jsonb,
     'T1', '协会', true),

    -- ❌ verify 2026-05-12: 404 — CWEA 网站已下线
    ('中国可再生能源学会风能专业委员会 CWEA',
     'http://www.cwea.org.cn/news.html',
     'html',
     '{"type":"html","listUrl":"http://www.cwea.org.cn/news.html","selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '协会', false),

    -- ❌ verify 2026-05-12: 404 — CPIA 网站已下线
    ('中国光伏行业协会 CPIA',
     'http://www.chinapv.org.cn/news.html',
     'html',
     '{"type":"html","listUrl":"http://www.chinapv.org.cn/news.html","selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '协会', false),

    -- ✅ verify 2026-05-12: 200 154KB — 修正 selectors.item 为 ul.infoList > li
    ('中国电力新闻网',
     'http://www.cpnn.com.cn/',
     'html',
     '{"type":"html","listUrl":"http://www.cpnn.com.cn/","selectors":{"item":"ul.infoList > li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', true),

    -- ❌ verify 2026-05-12: 403 — 人民日报电子版拒绝抓取
    ('中国能源报',
     'https://paper.people.com.cn/zgnyb/',
     'html',
     '{"type":"html","listUrl":"https://paper.people.com.cn/zgnyb/","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', false),

    -- ❌ verify 2026-05-12: 404 — 储能网域名已失效
    ('储能网 escn',
     'https://www.escn.com.cn/news/',
     'html',
     '{"type":"html","listUrl":"https://www.escn.com.cn/news/","selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', false),

    -- ❌ verify 2026-05-12: TLS handshake fail — 保持 false
    ('电缆网 cableabc',
     'https://www.cableabc.com/news/',
     'html',
     '{"type":"html","listUrl":"https://www.cableabc.com/news/","selectors":{"item":"li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', false),

    -- ❌ verify 2026-05-12: HTTP 500 — 保持 false
    ('巨潮资讯',
     'http://www.cninfo.com.cn/new/disclosure',
     'html',
     '{"type":"html","listUrl":"http://www.cninfo.com.cn/new/disclosure","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '上市公司公告', false),

    -- ❌ verify 2026-05-12: anti-bot — 保持 false
    ('知乎 电力话题',
     'https://www.zhihu.com/topic/19577810',
     'playwright',
     '{"type":"playwright","listUrl":"https://www.zhihu.com/topic/19577810","waitFor":"body","extractor":"() => Array.from(document.querySelectorAll(''a'')).slice(0,10).map(a => ({ title: a.textContent || '''', url: a.href }))"}'::jsonb,
     'T3', '自媒体', false)

ON CONFLICT (url) DO NOTHING;

COMMIT;
