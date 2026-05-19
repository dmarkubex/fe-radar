-- Migration 0009: commodity seed — v1.1 信源 + 2026 节假日 + 模板占位符
-- ============================================================
-- IMPORTANT (v0.4 fix E4):
--   This file is **seed-only / first-init**.
--   All three INSERT blocks use ON CONFLICT DO NOTHING.
--   Admin changes made via the back-office will NOT be overwritten
--   if this migration is re-run.
--   To add new fields after the initial seed, create a new
--   migration (0010+) — never edit this file directly.
--   This file's number (0009) serves as the seed_version audit
--   anchor; do not renumber it.
-- ============================================================
-- Prerequisites: 0008_commodity_briefing.sql (6 new tables +
--   sources.fetcher_type CHECK extended to include 'quotes')
-- ============================================================

BEGIN;

-- ============================================================
-- A. v1.1 quotes 信源 seed
--    All rows: fetcher_type='quotes', enabled=false
--    (adapters are enabled manually via admin after DMA-162/163
--    deployment; default-disabled is a hard constraint per CLAUDE.md)
--    Tier assignment per design.md §5:
--      T1 = official exchange / PBOC (authoritative, low-latency)
--      T2 = ChinaBond / RSSHub-extract (derived / third-party)
-- ============================================================

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
  (
    'SHFE 沪铜主力',
    'http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "shfe",
      "metric_keys": ["cu_main_close", "cu_main_open", "cu_main_high", "cu_main_low", "cu_main_volume", "cu_change_pct", "cu_warrants"],
      "endpoint": "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat",
      "retry": {"max": 3, "backoffMs": 1500}
    }'::jsonb,
    'T1', '市场数据', false
  ),
  (
    'GFEX 碳酸锂主力',
    'http://www.gfex.com.cn/u/interfaceShow/queryDayQuotes.do',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "gfex",
      "metric_keys": ["lc_main_close", "lc_main_open", "lc_main_high", "lc_main_low", "lc_main_volume", "lc_change_pct", "lc_warrants"],
      "endpoint": "http://www.gfex.com.cn/u/interfaceShow/queryDayQuotes.do",
      "retry": {"max": 3, "backoffMs": 1500}
    }'::jsonb,
    'T1', '市场数据', false
  ),
  (
    'LME 伦铜',
    'https://www.lme.com/api/rings/lme-copper',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "lme",
      "metric_keys": ["lme_cu_3m", "lme_cu_cash", "lme_cu_change_pct"],
      "endpoint": "https://www.lme.com/api/rings/lme-copper",
      "retry": {"max": 3, "backoffMs": 2000}
    }'::jsonb,
    'T1', '市场数据', false
  ),
  (
    '央行汇率中间价',
    'http://www.pbc.gov.cn/rmyh/108976/109428/index.html',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "pboc",
      "metric_keys": ["fx_usdcny", "fx_eurcny", "fx_hkdcny"],
      "endpoint": "http://www.pbc.gov.cn/rmyh/108976/109428/index.html",
      "retry": {"max": 3, "backoffMs": 2000}
    }'::jsonb,
    'T1', '市场数据', false
  ),
  (
    '中国货币网 10Y 国债',
    'https://www.chinamoney.com.cn/ags/ms/cm-u-bond-md/CbMktYield.do',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "chinabond",
      "metric_keys": ["cny_10y_yield", "cny_5y_yield", "cny_2y_yield"],
      "endpoint": "https://www.chinamoney.com.cn/ags/ms/cm-u-bond-md/CbMktYield.do",
      "retry": {"max": 3, "backoffMs": 2000}
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-SMM 铜',
    'http://rsshub:1200/smm/news/cu',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["cu_spot_smm"],
      "endpoint": "/smm/news/cu",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "cu_spot_smm",
          "pattern": "(?:现货|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
          "unit_multiplier": 1
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-SMM 碳酸锂',
    'http://rsshub:1200/smm/news/lc',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["lc_spot_smm"],
      "endpoint": "/smm/news/lc",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "lc_spot_smm",
          "pattern": "(?:碳酸锂|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
          "unit_multiplier": 10000
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-生意社铜现货',
    'http://rsshub:1200/100ppi/cu',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["cu_spot_100ppi"],
      "endpoint": "/100ppi/cu",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "cu_spot_100ppi",
          "pattern": "(?:现货|均价)[^\\d]*(\\d+(?:\\.\\d+)?)",
          "unit_multiplier": 1
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-长江有色铜',
    'http://rsshub:1200/cjsc/cu',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["cu_spot_cjsc"],
      "endpoint": "/cjsc/cu",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "cu_spot_cjsc",
          "pattern": "(\\d{4,6}(?:\\.\\d+)?)",
          "unit_multiplier": 1
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-中汽协新能源产销',
    'http://rsshub:1200/caam/ev',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["ev_sales_monthly"],
      "endpoint": "/caam/ev",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "ev_sales_monthly",
          "pattern": "(?:新能源|销量)[^\\d]*(\\d+(?:\\.\\d+)?)[^万]*万",
          "unit_multiplier": 10000
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-SMM 铝',
    'http://rsshub:1200/smm/news/al',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["al_spot_smm"],
      "endpoint": "/smm/news/al",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "al_spot_smm",
          "pattern": "(?:铝|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
          "unit_multiplier": 1
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  ),
  (
    'RSSHub 数值抽取-SMM 锌',
    'http://rsshub:1200/smm/news/zn',
    'quotes',
    '{
      "type": "quotes",
      "adapter": "rsshub-extract",
      "metric_keys": ["zn_spot_smm"],
      "endpoint": "/smm/news/zn",
      "retry": {"max": 2, "backoffMs": 1000},
      "regex_rules": [
        {
          "metric_key": "zn_spot_smm",
          "pattern": "(?:锌|均价|报价)[^\\d]*(\\d+(?:\\.\\d+)?)",
          "unit_multiplier": 1
        }
      ]
    }'::jsonb,
    'T2', '市场数据', false
  )

ON CONFLICT (url) DO NOTHING;

-- ============================================================
-- B. 2026 年中国法定节假日（11 个法定节假日）
--    Ref: 2026 年节假日安排（国务院办公厅通知）
--    Admin maintains subsequent years via back-office.
-- ============================================================

INSERT INTO briefing_holidays (holiday_date, name)
VALUES
  -- 元旦（1 天）
  ('2026-01-01', '元旦'),

  -- 春节（7 天：2026-02-17 ~ 2026-02-23）
  ('2026-02-17', '春节'),
  ('2026-02-18', '春节'),
  ('2026-02-19', '春节'),
  ('2026-02-20', '春节'),
  ('2026-02-21', '春节'),
  ('2026-02-22', '春节'),
  ('2026-02-23', '春节'),

  -- 清明节（1 天）
  ('2026-04-06', '清明节'),

  -- 劳动节（5 天：2026-05-01 ~ 2026-05-05）
  ('2026-05-01', '劳动节'),
  ('2026-05-02', '劳动节'),
  ('2026-05-03', '劳动节'),
  ('2026-05-04', '劳动节'),
  ('2026-05-05', '劳动节'),

  -- 端午节（1 天）
  ('2026-06-19', '端午节'),

  -- 中秋节（1 天）
  ('2026-09-25', '中秋节'),

  -- 国庆节（7 天：2026-10-01 ~ 2026-10-07）
  ('2026-10-01', '国庆节'),
  ('2026-10-02', '国庆节'),
  ('2026-10-03', '国庆节'),
  ('2026-10-04', '国庆节'),
  ('2026-10-05', '国庆节'),
  ('2026-10-06', '国庆节'),
  ('2026-10-07', '国庆节')

ON CONFLICT (holiday_date) DO NOTHING;

-- ============================================================
-- C. briefing_template_fields seed
--    Covers all {{placeholder}} keys used in
--    design/templates/briefing.docx.
--    Aligned with design.md §6.1 BRIEFING_SCHEMA (7 LLM segments)
--    + §6.5 code-computed support/resistance
--    + numeric metric_keys from quotes sources above.
--    is_active=true, fallback_text='—' for all rows.
--    ON CONFLICT (placeholder_key) DO NOTHING — admin edits
--    to label/fallback/is_active are preserved on re-run.
-- ============================================================

INSERT INTO briefing_template_fields
  (placeholder_key, label, source_metric, llm_path, fallback_text, is_active)
VALUES

  -- ----------------------------------------------------------
  -- § 静态 / 元信息占位符
  -- ----------------------------------------------------------
  ('briefing_date',         '简报日期',         NULL, NULL,                   '—',    true),
  ('template_version',      '模板版本号',        NULL, NULL,                   '1',    true),
  ('generated_at',          '生成时间',         NULL, NULL,                   '—',    true),
  ('report_disclaimer',     '免责声明',         NULL, NULL,
   '本简报仅供远东控股内部参考，不构成投资建议。', true),

  -- ----------------------------------------------------------
  -- § 沪铜 (SHFE 上期所)
  -- ----------------------------------------------------------
  ('cu_close',              '沪铜收盘价',        'cu_main_close',  NULL, '—', true),
  ('cu_open',               '沪铜开盘价',        'cu_main_open',   NULL, '—', true),
  ('cu_high',               '沪铜最高价',        'cu_main_high',   NULL, '—', true),
  ('cu_low',                '沪铜最低价',        'cu_main_low',    NULL, '—', true),
  ('cu_volume',             '沪铜成交量',        'cu_main_volume', NULL, '—', true),
  ('cu_change_pct',         '沪铜涨跌幅',        'cu_change_pct',  NULL, '—', true),
  ('cu_warrants',           '沪铜仓单',          'cu_warrants',    NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 碳酸锂 (GFEX 广期所)
  -- ----------------------------------------------------------
  ('lc_close',              '碳酸锂收盘价',      'lc_main_close',  NULL, '—', true),
  ('lc_open',               '碳酸锂开盘价',      'lc_main_open',   NULL, '—', true),
  ('lc_high',               '碳酸锂最高价',      'lc_main_high',   NULL, '—', true),
  ('lc_low',                '碳酸锂最低价',      'lc_main_low',    NULL, '—', true),
  ('lc_volume',             '碳酸锂成交量',      'lc_main_volume', NULL, '—', true),
  ('lc_change_pct',         '碳酸锂涨跌幅',      'lc_change_pct',  NULL, '—', true),
  ('lc_warrants',           '碳酸锂仓单',        'lc_warrants',    NULL, '—', true),

  -- ----------------------------------------------------------
  -- § LME 伦铜
  -- ----------------------------------------------------------
  ('lme_cu_close',          'LME 铜 3M 结算价',  'lme_cu_3m',      NULL, '—', true),
  ('lme_cu_cash',           'LME 铜现货价',      'lme_cu_cash',    NULL, '—', true),
  ('lme_cu_change_pct',     'LME 铜涨跌幅',      'lme_cu_change_pct', NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 汇率 & 利率
  -- ----------------------------------------------------------
  ('fx_usdcny',             '美元中间价',        'fx_usdcny',      NULL, '—', true),
  ('fx_eurcny',             '欧元中间价',        'fx_eurcny',      NULL, '—', true),
  ('fx_hkdcny',             '港元中间价',        'fx_hkdcny',      NULL, '—', true),
  ('cny_10y_yield',         '10Y 国债收益率',    'cny_10y_yield',  NULL, '—', true),
  ('cny_5y_yield',          '5Y 国债收益率',     'cny_5y_yield',   NULL, '—', true),
  ('cny_2y_yield',          '2Y 国债收益率',     'cny_2y_yield',   NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 铜现货价（SMM / 生意社 / 长江有色）
  -- ----------------------------------------------------------
  ('cu_spot_smm',           'SMM 铜现货均价',    'cu_spot_smm',    NULL, '—', true),
  ('cu_spot_100ppi',        '生意社铜现货价',    'cu_spot_100ppi', NULL, '—', true),
  ('cu_spot_cjsc',          '长江有色铜现货价',  'cu_spot_cjsc',   NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 碳酸锂现货价（SMM）
  -- ----------------------------------------------------------
  ('lc_spot_smm',           'SMM 碳酸锂现货均价', 'lc_spot_smm',   NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 代码计算：支撑位 / 压力位（design.md §6.5）
  --   llm_path 指向 payload_json 内由 worker 装配层注入的路径
  -- ----------------------------------------------------------
  ('cu_support',            '沪铜支撑位',        NULL, 'cu.outlook.support',     '—', true),
  ('cu_resistance',         '沪铜压力位',        NULL, 'cu.outlook.resistance',  '—', true),
  ('lc_support',            '碳酸锂支撑位',      NULL, 'lc.outlook.support',     '—', true),
  ('lc_resistance',         '碳酸锂压力位',      NULL, 'lc.outlook.resistance',  '—', true),

  -- ----------------------------------------------------------
  -- § LLM 段落（design.md §6.1 BRIEFING_SCHEMA 7 segments）
  -- ----------------------------------------------------------
  ('cu_logic_summary',      '铜逻辑摘要',        NULL, 'cu.logic_summary',       '—', true),
  ('cu_outlook_trend',      '铜趋势判断',        NULL, 'cu.outlook.trend',       '—', true),
  ('lc_logic_summary',      '碳酸锂逻辑摘要',   NULL, 'lc.logic_summary',       '—', true),
  ('lc_outlook_trend',      '碳酸锂趋势判断',   NULL, 'lc.outlook.trend',       '—', true),
  ('macro_summary',         '宏观摘要',          NULL, 'macro_summary',          '—', true),
  ('risk_notes',            '风险提示',          NULL, 'risk_notes',             '—', true),
  ('procurement_advice',    '采购建议',          NULL, 'procurement_advice',     '—', true),

  -- ----------------------------------------------------------
  -- § 新能源下游（EV 产销）
  -- ----------------------------------------------------------
  ('ev_sales_monthly',      '新能源汽车月销量',  'ev_sales_monthly', NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 铝 / 锌现货（周边品种，表格补充行）
  -- ----------------------------------------------------------
  ('al_spot_smm',           'SMM 铝现货均价',   'al_spot_smm',    NULL, '—', true),
  ('zn_spot_smm',           'SMM 锌现货均价',   'zn_spot_smm',    NULL, '—', true),

  -- ----------------------------------------------------------
  -- § 近 5 日涨跌序列文本（worker 装配层序列化后写入）
  -- ----------------------------------------------------------
  ('cu_5d_series',          '沪铜近 5 日收盘序列', NULL, 'cu.series_5d',         '—', true),
  ('lc_5d_series',          '碳酸锂近 5 日收盘序列', NULL, 'lc.series_5d',       '—', true),

  -- ----------------------------------------------------------
  -- § 页脚 / 版权
  -- ----------------------------------------------------------
  ('footer_date',           '页脚日期',          NULL, NULL,                   '—',    true),
  ('footer_company',        '出具机构',          NULL, NULL,           '远东控股集团', true)

ON CONFLICT (placeholder_key) DO NOTHING;

COMMIT;

-- ===========================================================================
-- ROLLBACK SQL（reference only — do NOT auto-exec）
-- Run manually to revert this seed migration if needed.
-- ===========================================================================
/*
BEGIN;
DELETE FROM briefing_template_fields;
DELETE FROM briefing_holidays WHERE holiday_date BETWEEN '2026-01-01' AND '2026-12-31';
DELETE FROM sources WHERE fetcher_type = 'quotes';
COMMIT;
*/
