-- Replace the robots-blocked PBOC feed with a keyless daily USD/CNY API.
-- The new source stays disabled until the production adapter smoke passes.
-- Rollback: UPDATE sources SET enabled = false WHERE url = 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json';

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES (
  'Exchange API USD/CNY',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
  'quotes',
  jsonb_build_object(
    'type', 'quotes',
    'adapter', 'exchange-api',
    'metric_keys', jsonb_build_array('fx_usdcny'),
    'endpoint', 'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
    'retry', jsonb_build_object('max', 3, 'backoffMs', 1500)
  ),
  'T2',
  '市场数据',
  false
)
ON CONFLICT (url) DO NOTHING;

UPDATE briefing_template_fields
SET label = 'USD/CNY 参考汇率'
WHERE placeholder_key = 'fx_usdcny'
  AND label = '美元中间价';

COMMIT;
