-- 0027_smm_quotes_sources.sql
-- 铜锂行情源收敛到上海有色金属网（SMM）。
-- 不修改 0009 初始 seed；本迁移作为产品决策 backfill：
--   1) disable 被 SMM 替代的铜/锂主行情源与旧 RSSHub-SMM 铜/锂源；
--   2) upsert 并启用两条 SMM HQ 源，直接产出页面主指标 cu_main_close / lc_main_close；
--   3) 同步保留 SMM 现货指标 cu_spot_smm / lc_spot_smm，兼容简报模板。

BEGIN;

UPDATE sources
SET enabled = false
WHERE fetcher_type = 'quotes'
  AND (
    name IN (
      'SHFE 沪铜主力',
      'GFEX 碳酸锂主力',
      'RSSHub 数值抽取-SMM 铜',
      'RSSHub 数值抽取-SMM 碳酸锂'
    )
    OR url IN (
      'http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat',
      'http://www.gfex.com.cn/u/interfaceShow/queryDayQuotes.do',
      'http://rsshub:1200/smm/news/cu',
      'http://rsshub:1200/smm/news/lc'
    )
    OR (config->'metric_keys') ?| ARRAY['cu_main_close', 'lc_main_close']
  )
  AND url NOT IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3');

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    'SMM 铜行情',
    'https://hq.smm.cn/h5/cu',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "smm-hq",
      "metric_keys": ["cu_main_close", "cu_spot_smm"],
      "endpoint": "https://hq.smm.cn/h5/cu",
      "retry": {"max": 3, "backoffMs": 2000},
      "items": [
        {
          "kind": "instrument",
          "metric_key": "cu_main_close",
          "column_no": "CUP01",
          "instrument_id": "cu0000",
          "typename": "沪铜期货主连价格",
          "value_field": "LastPrice"
        },
        {
          "kind": "product",
          "metric_key": "cu_spot_smm",
          "column_no": "CUP02",
          "product_id": "201102250376",
          "product_name": "上海今日铜价",
          "value_field": "average"
        }
      ]
    }'::jsonb,
    'T1',
    '市场数据',
    true
  ),
  (
    'SMM 碳酸锂行情',
    'https://hq.smm.cn/h5/Li2CO3',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "smm-hq",
      "metric_keys": ["lc_main_close", "lc_spot_smm"],
      "endpoint": "https://hq.smm.cn/h5/Li2CO3",
      "retry": {"max": 3, "backoffMs": 2000},
      "items": [
        {
          "kind": "product",
          "metric_key": "lc_main_close",
          "emit_metric_keys": ["lc_spot_smm"],
          "column_no": "LCP02",
          "product_id": "201102250059",
          "product_name": "电池级碳酸锂价格",
          "value_field": "average"
        }
      ]
    }'::jsonb,
    'T1',
    '市场数据',
    true
  )
ON CONFLICT (url) DO UPDATE
SET name = EXCLUDED.name,
    fetcher_type = EXCLUDED.fetcher_type,
    config = EXCLUDED.config,
    tier = EXCLUDED.tier,
    category = EXCLUDED.category,
    enabled = true,
    fail_count = 0,
    last_error = NULL;

COMMIT;

-- Rollback:
-- UPDATE sources SET enabled = false WHERE url IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3');
