-- 0063_source_gate0_batch6_channels.sql
-- Gate 0 第六批：南网储能招采变体（698 的储能关键词补充行）。
-- 依据 2026-08-15 生产探测：dbsearch.jspx 搜索端点结构同 .List2 ul > li，698 电缆变体已验证。
-- 默认禁用，逐源生产烟测后启用。回滚：软禁本行 URL，不物理删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    '南方电网储能招采',
    'https://www.bidding.csg.cn/dbsearch.jspx?channelId=309&types=&org=&q=%E5%82%A8%E8%83%BD',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.bidding.csg.cn/dbsearch.jspx?channelId=309&types=&org=&q=%E5%82%A8%E8%83%BD',
      'selectors', jsonb_build_object(
        'item', '.List2 ul > li',
        'title', 'a[target="_blank"]',
        'link', 'a[target="_blank"]',
        'date', '.Right .Gray'
      ),
      'keywordFilter', jsonb_build_array('储能', '电池', 'PCS', 'BMS', 'EMS', '抽水蓄能', '电化学'),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('downstream', 'products'),
        'signalKinds', jsonb_build_array('tender'),
        'maxAgeHours', 168
      )
    ),
    'T1',
    '央企招采',
    false
  )
ON CONFLICT (url) DO NOTHING;

COMMIT;
