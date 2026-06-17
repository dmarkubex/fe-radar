-- 0023_sources_fetch_refresh.sql
-- 全量信源审计（2026-06）：刷新 404/过期 URL 与 selector；合规禁用 robots/失效域/JS 动态页。
-- 幂等：按 name 精确匹配，不覆盖 admin 已改名的信源。

BEGIN;

-- 国家能源局：/xwzx/zyxw.htm 已 404，改新闻中心列表页
UPDATE sources
SET url          = 'https://www.nea.gov.cn/xwzx/index.htm',
    config       = '{"type":"html","listUrl":"https://www.nea.gov.cn/xwzx/index.htm","useRealUa":true,"selectors":{"item":".list01 li","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '国家能源局';

-- 中国光伏行业协会：/news.html 404，改首页 .news 列表
UPDATE sources
SET url          = 'http://www.chinapv.org.cn/',
    config       = '{"type":"html","listUrl":"http://www.chinapv.org.cn/","useRealUa":true,"selectors":{"item":".news li","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '中国光伏行业协会 CPIA';

-- 储能网：/news/ 404，改首页新闻区
UPDATE sources
SET url          = 'https://www.escn.com.cn/',
    config       = '{"type":"html","listUrl":"https://www.escn.com.cn/","useRealUa":true,"selectors":{"item":".xinwenConBox a","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '储能网 escn';

-- 高工储能：/zixun/ 404，改首页轮播新闻区
UPDATE sources
SET url          = 'https://www.estv.com.cn/',
    config       = '{"type":"html","listUrl":"https://www.estv.com.cn/","useRealUa":true,"selectors":{"item":".Es_New_1_m_li","title":"a","link":"a","date":"span"}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '高工储能';

-- 钛媒体：/nav/clean 404，改 nictation 快讯列表
UPDATE sources
SET url          = 'https://www.tmtpost.com/nictation',
    config       = '{"type":"html","listUrl":"https://www.tmtpost.com/nictation","useRealUa":true,"selectors":{"item":"a[href*=\"/nictation/\"]","title":"a","link":"a","date":""}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '钛媒体 新能源';

-- 网易财经：专题页 404，改首页 channel_news
UPDATE sources
SET url          = 'https://money.163.com/',
    config       = '{"type":"html","listUrl":"https://money.163.com/","useRealUa":true,"selectors":{"item":".channel_news li","title":".news_title a","link":"a","date":".news_time"}}'::jsonb,
    enabled      = true,
    fail_count   = 0,
    last_error   = NULL
WHERE name = '网易财经 能源';

-- CWEA：news_lastest.js 动态注入，HTML fetcher 恒 0 条
UPDATE sources
SET enabled    = false,
    last_error = 'news_lastest.js 动态加载，HTML fetcher 无法解析'
WHERE name = '中国可再生能源学会风能专业委员会 CWEA';

-- 中国能源报：机房 IP 403
UPDATE sources
SET enabled    = false,
    last_error = 'paper.people.com.cn 对机房 IP 返回 403'
WHERE name = '中国能源报';

-- 中国电网：域名全站 404
UPDATE sources
SET enabled    = false,
    last_error = 'china-power.com.cn 全站不可达（404）'
WHERE name = '中国电网 china-power';

-- 搜狗微信 / 雪球：robots 明确禁止，合规停抓
UPDATE sources
SET enabled    = false,
    last_error = 'robots.txt disallows /weixin（搜狗微信）'
WHERE name IN ('电缆头条', '储能头条');

UPDATE sources
SET enabled    = false,
    last_error = 'robots.txt disallows /k'
WHERE name = '雪球 行业讨论';

COMMIT;

-- Rollback (manual): 按 0004/0011 seed 恢复各源 url/config/enabled
