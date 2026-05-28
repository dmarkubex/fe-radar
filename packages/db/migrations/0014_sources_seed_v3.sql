-- 0014_sources_seed_v3.sql
-- KYO-57: government/association HTML news source selector fixes (seed v3)
-- 策略：
--   B 组（URL 变更）：UPDATE WHERE name=... AND url=<旧 url>
--   A 组（URL 不变）：INSERT ... ON CONFLICT (url) DO UPDATE SET 目标字段

BEGIN;

-- ============================================================
-- B 组：URL 变更 — 工信部 / 中电联
-- ============================================================

-- ❌ verify 2026-05-28: current agent network cannot reach .gov.cn; keep disabled until deployment-network smoke returns >=3 items.
UPDATE sources
SET url          = 'https://www.miit.gov.cn/xwdt/gxdt/index.html',
    fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://www.miit.gov.cn/xwdt/gxdt/index.html","useRealUa":true,"selectors":{"item":".list ul li, .cata-list li","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = false
WHERE name = '工信部'
  AND url  = 'https://www.miit.gov.cn/xwdt/gxdt/';

-- ❌ verify 2026-05-28: current agent network cannot reach cec.org.cn; keep disabled until deployment-network smoke returns >=3 items.
UPDATE sources
SET url          = 'https://www.cec.org.cn/yaowen/index.jhtml',
    fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"https://www.cec.org.cn/yaowen/index.jhtml","useRealUa":true,"selectors":{"item":".list-ul li, ul.list li, #list li","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = false
WHERE name = '中电联'
  AND url  = 'https://www.cec.org.cn/menu/index.html?94';

-- ============================================================
-- A 组：URL 不变 — 修正 selectors / useRealUa
-- ============================================================

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    -- ❌ verify 2026-05-28: current agent network cannot reach ndrc.gov.cn; keep disabled until deployment-network smoke returns >=3 items.
    ('国家发改委',
     'https://www.ndrc.gov.cn/xwdt/xwfb/',
     'html',
     '{"type":"html","listUrl":"https://www.ndrc.gov.cn/xwdt/xwfb/","useRealUa":true,"selectors":{"item":"ul.u-list > li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '政府', false),

    -- ✅ verify 2026-05-28: HTTP 200, selector matched 21 items in Cursor and Planner smoke runs.
    ('中国电器工业协会',
     'http://www.ceeia.com/news/',
     'html',
     '{"type":"html","listUrl":"http://www.ceeia.com/news/","useRealUa":true,"selectors":{"item":".notice-list.tab-con.active p.text-of","title":"a","link":"a","date":"span"}}'::jsonb,
     'T1', '协会', true),

    -- ❌ verify 2026-05-28: Planner smoke reached HTTP 200 but selector matched 0 items; keep disabled pending selector refresh.
    ('中关村储能产业技术联盟 CNESA',
     'http://www.cnesa.org/index/news',
     'html',
     '{"type":"html","listUrl":"http://www.cnesa.org/index/news","selectors":{"item":"article.et-item","title":"a","link":"a","date":"time"}}'::jsonb,
     'T1', '协会', false),

    -- ✅ verify 2026-05-28: HTTP 200, selector matched 10 items in Cursor and Planner smoke runs.
    ('中国电力新闻网',
     'http://www.cpnn.com.cn/',
     'html',
     '{"type":"html","listUrl":"http://www.cpnn.com.cn/","selectors":{"item":"ul.infoList > li","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', true),

    -- ❌ verify 2026-05-28: smoke regressed from 72 items to 0 across environments; keep disabled pending selector refresh or Playwright follow-up.
    ('索比光伏网',
     'https://www.solarbe.com/news/',
     'html',
     '{"type":"html","listUrl":"https://www.solarbe.com/news/","useRealUa":true,"selectors":{"item":".xNews_left a[href*=\"news.solarbe.com/20\"]","title":"a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', false),

    -- ✅ verify 2026-05-28: HTTP 200, selector matched 70 items in Cursor and Planner smoke runs.
    ('国际能源网',
     'https://www.in-en.com/news/',
     'html',
     '{"type":"html","listUrl":"https://www.in-en.com/news/","useRealUa":true,"selectors":{"item":"ul.infoList > li","title":".listTxt h5 a","link":"a","date":"span"}}'::jsonb,
     'T2', '媒体-垂直', true)

ON CONFLICT (url) DO UPDATE
    SET fetcher_type = EXCLUDED.fetcher_type,
        config       = EXCLUDED.config,
        enabled      = EXCLUDED.enabled,
        category     = EXCLUDED.category,
        tier         = EXCLUDED.tier;

COMMIT;
