-- 0013_announcement_sources_seed.sql
-- 用途：统一 seed 三个 announcement 公告源（SSE / SZSE / CNINFO）
-- 编号：片4 独占写此 migration，片1/2/3 不写 seed
-- 策略：INSERT ... ON CONFLICT (url) DO UPDATE 保证幂等
--   通过 smoke 的源 enabled=true，未通过的 enabled=false 并注释原因

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    -- SSE 上交所公告 — smoke 验证通过（2026-05-27 片2 KyO-62 返回 ≥5 条）
    ('上交所公告',
     'http://www.sse.com.cn/disclosure/listedinfo/announcement/',
     'announcement',
     '{"type":"announcement","adapter":"sse","endpoint":"http://query.sse.com.cn/security/stock/queryCompanyBulletin.do","useRealUa":true}'::jsonb,
     'T1', '上市公司公告', true),

    -- SZSE 深交所公告 — smoke 验证通过（2026-05-27 片3 KyO-63 返回 ≥5 条）
    ('深交所公告',
     'http://www.szse.cn/disclosure/listed/notice/',
     'announcement',
     '{"type":"announcement","adapter":"szse","useRealUa":true}'::jsonb,
     'T1', '上市公司公告', true),

    -- CNINFO 巨潮资讯 — smoke 验证通过（2026-05-28 片4 KyO-64 返回 ≥5 条）
    -- 巨潮 hisAnnouncement POST API 返回 17671 条公告记录，前 5 条含完整字段
    ('巨潮资讯公告',
     'http://www.cninfo.com.cn/new/disclosure',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","useRealUa":true}'::jsonb,
     'T1', '上市公司公告', true)

ON CONFLICT (url) DO UPDATE
    SET fetcher_type = EXCLUDED.fetcher_type,
        config       = EXCLUDED.config,
        enabled      = EXCLUDED.enabled,
        category     = EXCLUDED.category,
        tier         = EXCLUDED.tier;

COMMIT;

-- ===========================================================================
-- ROLLBACK SQL（reference only — do NOT auto-exec）
-- Run manually to revert this migration if needed.
-- ===========================================================================
/*
BEGIN;

-- 恢复三个源为原来的 html fetcher_type + 旧 config
-- 上交所公告（0011 未覆盖此 url，0004 原 url 为 http://www.sse.com.cn/disclosure/listedinfo/announcement/）
UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"http://www.sse.com.cn/disclosure/listedinfo/announcement/","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = true
WHERE name = '上交所公告'
  AND url  = 'http://www.sse.com.cn/disclosure/listedinfo/announcement/';

-- 深交所公告
UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"http://www.szse.cn/disclosure/listed/notice/","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = true
WHERE name = '深交所公告'
  AND url  = 'http://www.szse.cn/disclosure/listed/notice/';

-- 巨潮资讯
UPDATE sources
SET fetcher_type = 'html',
    config       = '{"type":"html","listUrl":"http://www.cninfo.com.cn/new/disclosure","selectors":{"item":"a","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = false
WHERE name = '巨潮资讯公告'
  AND url  = 'http://www.cninfo.com.cn/new/disclosure';

COMMIT;
*/
