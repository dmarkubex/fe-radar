-- 0047_source_gate0_seed.sql
-- Gate 0 首批候选源。全部默认禁用，生产单源验证通过后再由 admin 启用。
-- 回滚：先软禁；仅在零引用时删除，禁止按 URL 无条件删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    '东方电缆官方新闻',
    'https://www.orientcable.com/ajax.asp?p=ajax_news_list&l=cn&a=1',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.orientcable.com/ajax.asp?p=ajax_news_list&l=cn&a=1',
      'selectors', jsonb_build_object(
        'item', 'ul > li.animate_box',
        'title', 'h3',
        'link', 'a',
        'date', 'div',
        'content', 'h3'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '竞品官网',
    false
  ),
  (
    '国家电网公开招采',
    'https://ecp.sgcc.com.cn/ecp2.0/portal/',
    'announcement',
    jsonb_build_object(
      'type', 'announcement',
      'adapter', 'sgcc-tender',
      'endpoint', 'https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore/index/noteList',
      'keywords', jsonb_build_array(
        '电线', '电缆', '导线', '导体', '铜芯', '铝芯',
        '储能', '电池', 'PCS', 'BMS', 'EMS'
      ),
      'noticeKinds', jsonb_build_array('tender', 'purchase', 'candidate', 'result'),
      'pageSize', 20,
      'useRealUa', true,
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('downstream', 'products'),
        'signalKinds', jsonb_build_array('tender'),
        'maxAgeHours', 168
      )
    ),
    'T1',
    '央企招采',
    false
  ),
  (
    '南方电网公开招采',
    'https://www.bidding.csg.cn/zbcg/index.jhtml',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.bidding.csg.cn/zbcg/index.jhtml',
      'selectors', jsonb_build_object(
        'item', '.List2 ul > li',
        'title', 'a[target="_blank"]',
        'link', 'a[target="_blank"]',
        'date', '.Right .Gray'
      ),
      'keywordFilter', jsonb_build_array(
        '电线', '电缆', '导线', '导体', '铜芯', '铝芯',
        '储能', '电池', 'PCS', 'BMS', 'EMS'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('downstream', 'products'),
        'signalKinds', jsonb_build_array('tender'),
        'maxAgeHours', 168
      )
    ),
    'T1',
    '央企招采',
    false
  ),
  (
    '中国电建公开招采',
    'https://bid.powerchina.cn/index',
    'announcement',
    jsonb_build_object(
      'type', 'announcement',
      'adapter', 'powerchina-tender',
      'endpoint', 'https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/list',
      'keywords', jsonb_build_array(
        '电线', '电缆', '导线', '导体', '铜芯', '铝芯',
        '储能', '电池', 'PCS', 'BMS', 'EMS'
      ),
      'noticeKinds', jsonb_build_array('tender', 'purchase', 'candidate', 'result'),
      'pageSize', 20,
      'useRealUa', true,
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('downstream', 'products'),
        'signalKinds', jsonb_build_array('tender'),
        'maxAgeHours', 168
      )
    ),
    'T1',
    '央企招采',
    false
  ),
  (
    '国家能源集团公开招采',
    'https://www.chnenergybidding.com.cn/bidweb/',
    'announcement',
    jsonb_build_object(
      'type', 'announcement',
      'adapter', 'chnenergy-tender',
      'endpoint', 'https://www.chnenergybidding.com.cn/bidweb/',
      'keywords', jsonb_build_array(
        '电线', '电缆', '导线', '导体', '铜芯', '铝芯',
        '储能', '电池', 'PCS', 'BMS', 'EMS'
      ),
      'noticeKinds', jsonb_build_array('tender', 'purchase', 'candidate', 'result'),
      'useRealUa', true,
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
