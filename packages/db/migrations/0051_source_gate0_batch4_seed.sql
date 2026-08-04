-- 0051_source_gate0_batch4_seed.sql
-- Gate 0 第四批海缆与储能官方一手源。逐源生产烟测前全部保持禁用。
-- 回滚：只软禁本批 URL；已有引用的 source 行不物理删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    'Nexans 官方发布',
    'https://www.nexans.com/news-media-room/press-releases/',
    'announcement',
    jsonb_build_object(
      'type', 'announcement',
      'adapter', 'nexans-news',
      'endpoint', 'https://www.nexans.com/ajax.php?action=last_posts&cpt_slug=documents&wpml_lang=en&page=1&tag_to_display=document_types',
      'pageSize', 50,
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'products', 'downstream'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '竞品官网',
    false
  ),
  (
    '华为数字能源储能新闻',
    'https://digitalpower.huawei.com/en/news',
    'announcement',
    jsonb_build_object(
      'type', 'announcement',
      'adapter', 'huawei-digital-power-news',
      'endpoint', 'https://digitalpower.huawei.com/service/portalapplication/v1/digitalpower/news',
      'contentId', '48e0a5ce972c4e4aa847fd0e1b127b19',
      'searchkey', 'ESS',
      'pageSize', 50,
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'products', 'downstream'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  ),
  (
    '亿纬锂能官方新闻',
    'https://www.evebattery.com/news',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.evebattery.com/news',
      'useRealUa', true,
      'keywordFilter', jsonb_build_array('储能', '锂电', '电池', 'BBU', 'HVDC', '氢锂钠', '电化学'),
      'selectors', jsonb_build_object(
        'item', '.s_e1cont2 .s_e1c2list',
        'title', '.s_e1c2nr p',
        'link', 'a',
        'date', '.s_e1c2wztime p',
        'content', '.s_e1c2nr p'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'upstream', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  )
ON CONFLICT (url) DO NOTHING;

COMMIT;
