-- 0048_source_gate0_batch2_seed.sql
-- Gate 0 第二批官方一手源。生产 worker 只读预检已解析出 >=3 条；正式逐源烟测前保持禁用。
-- 回滚：只软禁本批 URL；已有引用的 source 行不物理删除。

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    '中天科技官方新闻',
    'https://m.ztt.cn/news_list.html',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://m.ztt.cn/news_list.html',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.am-gallery > li',
        'title', '.am-gallery-title',
        'link', 'a',
        'date', '.am-gallery-desc',
        'content', '.am-gallery-title'
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
    '江南电缆官方新闻',
    'https://www.jncable.com.cn/cn/news.html',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.jncable.com.cn/cn/news.html',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.newslist02 > li',
        'title', '.tit a',
        'link', '.tit a',
        'date', '.date',
        'content', '.desc'
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
    '起帆电缆官方新闻',
    'https://www.shqfdl.com/m/news.aspx',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.shqfdl.com/m/news.aspx',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.main.news_con > ul > li',
        'title', 'a',
        'link', 'a',
        'date', 'span',
        'content', 'a'
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
    'CNESA 储能行业资讯',
    'https://www.cnesa.org/information/?column_id=1',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.cnesa.org/information/?column_id=1',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', '.policy-list',
        'title', '.fs-18 > .text-bar1',
        'link', 'a',
        'date', '.fs-14.text-999',
        'content', '.fs-14.text-616'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('industry_policy', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '协会',
    false
  ),
  (
    '阳光电源官方新闻',
    'https://dl.sungrowpower.com/news.html?class_id=6',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://dl.sungrowpower.com/news.html?class_id=6',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'a.swiper-slide[href*="/news/"]',
        'title', '.h',
        'link', 'a',
        'date', '.p2',
        'content', '.p'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'downstream', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  ),
  (
    '海博思创官方新闻',
    'https://www.hyperstrong.com/cn/news/company-news',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.hyperstrong.com/cn/news/company-news',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'li.ncts_ul_li, li.ncbu_li',
        'title', '.std_title6, .std_title20',
        'link', 'a',
        'date', '.nulr_cont_time p, .ncbu_li_time p',
        'content', '.nulr_cont_parga p, .std_title6, .std_title20'
      ),
      'gate0', jsonb_build_object(
        'domains', jsonb_build_array('competitors', 'downstream', 'products'),
        'maxAgeHours', 2160
      )
    ),
    'T1',
    '储能企业官网',
    false
  ),
  (
    '国轩高科官方新闻',
    'https://www.gotion.com.cn/news',
    'html',
    jsonb_build_object(
      'type', 'html',
      'listUrl', 'https://www.gotion.com.cn/news',
      'useRealUa', true,
      'selectors', jsonb_build_object(
        'item', 'a.item[href*="/newsInfo/"]',
        'title', '.title',
        'link', 'a',
        'date', '.time',
        'content', '.title'
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
