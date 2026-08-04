-- 0050_source_gate0_batch3_seed.sql
-- Gate 0 第三批海外电缆、海缆与储能官方一手源。逐源生产烟测前全部保持禁用。
-- 回滚：只软禁本批 URL；已有引用的 source 行不物理删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    'LS Cable & System 官方新闻',
    'https://news.lscns.com/feed/',
    'rss',
    jsonb_build_object(
      'type', 'rss',
      'url', 'https://news.lscns.com/feed/',
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
    'Prysmian 官方新闻',
    'https://www.prysmian.com/en/media/press-releases?field_press_category_new_tid=1704',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.prysmian.com/en/media/press-releases?field_press_category_new_tid=1704',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'ol.news_list li.ct-module',
        'title', '.prys2-search-result__title a',
        'link', '.prys2-search-result__title a',
        'date', '.news-archive-date a',
        'content', '.prys2-search-result__title'
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
    'CATL 官方新闻',
    'https://www.catl.com/en/news/',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.catl.com/en/news/',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'li.mc_e1_li',
        'title', '.mc_e1_txt',
        'link', 'a.mc_e1_lisbox',
        'date', '.mc_e1_date',
        'content', '.mc_e1_txt'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'upstream', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  ),
  (
    'Sungrow 海外官方新闻',
    'https://www.sungrowpower.com/en/news-media-news-list',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.sungrowpower.com/en/news-media-news-list',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'a.flex.items-start[href^="/en/"]',
        'title', 'div[class*="vw-text-[30]"][class*="hover:text-system-orange"]',
        'link', 'a',
        'date', 'div[class*="vw-text-[18]"][class*="leading-[0.66667]"]',
        'content', 'div[class*="vw-text-[30]"][class*="hover:text-system-orange"]'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'downstream', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  )
ON CONFLICT (url) DO NOTHING;

COMMIT;
