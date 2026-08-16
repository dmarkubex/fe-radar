-- 0062_source_gate0_batch5_international.sql
-- Gate 0 第五批国际储能与电力市场信源。全部默认禁用，逐源生产烟测 + 相关率复测后启用。
-- 生产探测证据见 spec/source-gate0/evidence-2026-08-15.md（2026-08-15 生产 worker 网络实测）。
-- 回滚：只软禁本批 URL；已有引用的 source 行不物理删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    'ESS News（国际储能）',
    'https://www.ess-news.com/feed/',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://www.ess-news.com/feed/',
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('products', 'downstream', 'industry_policy'),
        'maxAgeHours', 2160
      )
    ),
    'T2',
    '媒体-垂直',
    false
  ),
  (
    'Utility Dive（美国公用事业）',
    'https://www.utilitydive.com/feeds/news/',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://www.utilitydive.com/feeds/news/',
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('downstream', 'industry_policy'),
        'maxAgeHours', 2160
      )
    ),
    'T2',
    '媒体-垂直',
    false
  ),
  (
    'pv magazine（光伏与储能）',
    'https://www.pv-magazine.com/feed/',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://www.pv-magazine.com/feed/',
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('products', 'downstream'),
        'maxAgeHours', 2160
      )
    ),
    'T2',
    '媒体-垂直',
    false
  ),
  (
    'Canary Media（清洁能源）',
    'https://www.canarymedia.com/feed',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://www.canarymedia.com/feed',
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('products', 'downstream', 'industry_policy'),
        'maxAgeHours', 2160
      )
    ),
    'T2',
    '媒体-垂直',
    false
  ),
  (
    'Europacable 欧洲电缆协会',
    'https://europacable.eu/feed/',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://europacable.eu/feed/',
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('products', 'industry_policy'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '协会',
    false
  ),
  (
    'EIA Today in Energy（美国能源署）',
    'https://www.eia.gov/todayinenergy/',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.eia.gov/todayinenergy/',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.tie-article',
        'title', 'h1 a',
        'link', 'h1 a',
        'date', 'span.date',
        'content', 'h1 a'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('industry_policy', 'downstream', 'upstream'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '政府',
    false
  ),
  (
    'Wärtsilä 瓦锡兰官方新闻',
    'https://www.wartsila.com/media/news',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.wartsila.com/media/news',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.news-list__item',
        'title', 'a p',
        'link', 'a',
        'date', '.news-list__date-label',
        'content', 'a p'
      ),
      'keywordFilter', jsonb_build_array(
        'energy', 'Energy', 'storage', 'Storage', 'BESS',
        'power', 'Power', 'grid', 'Grid', 'battery', 'Battery',
        'solar', 'Solar', 'wind', 'Wind', 'data center', 'Data Center'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'products', 'downstream'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  )
ON CONFLICT (url) DO NOTHING;

COMMIT;
