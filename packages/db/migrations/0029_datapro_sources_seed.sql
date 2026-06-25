-- 0029_datapro_sources_seed.sql
-- v1.2 火山方舟 Agent Plan Harness — dataPro 专业数据集 seed（企业风险 + 金融数据库）
-- 依赖 0028（fetcher_type CHECK 已含 'datapro' + entity_financials 表已建）
-- entities 列表来源：migration 0019 已 seed 14 家 C2 上市公司 stockCode

BEGIN;

-- dataPro 企业风险库（T1）— 司法诉讼/行政处罚/失信/经营异常
INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    ('dataPro-C2企业风险',
     'https://datapro.hqd.cn-beijing.volces.com/mcp/risk',
     'datapro',
     '{
       "type": "datapro",
       "dataType": "risk",
       "entities": [
         {"name": "宝胜股份", "stockCode": "600973"},
         {"name": "中天科技", "stockCode": "600522"},
         {"name": "亨通光电", "stockCode": "600487"},
         {"name": "起帆电缆", "stockCode": "605222"},
         {"name": "金杯电工", "stockCode": "002533"},
         {"name": "江西铜业", "stockCode": "600362"},
         {"name": "铜陵有色", "stockCode": "000630"},
         {"name": "云南铜业", "stockCode": "000878"},
         {"name": "宁德时代", "stockCode": "300750"},
         {"name": "比亚迪", "stockCode": "002594"},
         {"name": "亿纬锂能", "stockCode": "300014"},
         {"name": "国轩高科", "stockCode": "002074"}
       ],
       "maxStocksPerQuery": 3
     }'::jsonb,
     'T1', '企业风险', false),

-- dataPro 金融数据库（T1）— ROE/净利润/营收等核心指标 → entity_financials
    ('dataPro-C2财务监测',
     'https://datapro.hqd.cn-beijing.volces.com/mcp/financial',
     'datapro',
     '{
       "type": "datapro",
       "dataType": "financial",
       "entities": [
         {"name": "宝胜股份", "stockCode": "600973"},
         {"name": "中天科技", "stockCode": "600522"},
         {"name": "亨通光电", "stockCode": "600487"},
         {"name": "起帆电缆", "stockCode": "605222"},
         {"name": "金杯电工", "stockCode": "002533"},
         {"name": "江西铜业", "stockCode": "600362"},
         {"name": "铜陵有色", "stockCode": "000630"},
         {"name": "云南铜业", "stockCode": "000878"},
         {"name": "宁德时代", "stockCode": "300750"},
         {"name": "比亚迪", "stockCode": "002594"},
         {"name": "亿纬锂能", "stockCode": "300014"},
         {"name": "国轩高科", "stockCode": "002074"}
       ],
       "metrics": ["roe", "net_profit", "revenue", "revenue_growth", "net_profit_growth"],
       "maxStocksPerQuery": 3
     }'::jsonb,
     'T1', '财务监测', false)

-- 仅首次初始化；admin 后台修改不被 reseed 覆盖。
-- seed 默认 enabled=false — 等 admin 验证 adapter 后手动启用。
ON CONFLICT (url) DO NOTHING;

COMMIT;

-- 部署后：在 Portainer 配置 DATAPRO_AGENT_PLAN_KEY，admin 将 enabled 改为 true
