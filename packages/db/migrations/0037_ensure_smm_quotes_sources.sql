-- Repair databases whose migration ledger was baselined past 0027 even though
-- the two deployment-managed SMM quote sources were never created.
--
-- Default-disabled is intentional: an admin must enable the sources after the
-- adapter image is deployed and a live fetch succeeds. Existing rows are never
-- overwritten, so admin-managed enabled/config state remains authoritative.

BEGIN;

INSERT INTO sources (
  name,
  url,
  fetcher_type,
  config,
  tier,
  category,
  enabled,
  url_locked
)
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
    false,
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
    false,
    true
  )
ON CONFLICT (url) DO NOTHING;

COMMIT;

-- Rollback (manual only):
-- DELETE FROM sources
-- WHERE url IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3')
--   AND last_ok_at IS NULL
--   AND admin_touched_at IS NULL;
