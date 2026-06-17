-- 0020_crawl_fetcher_type_and_c1_risk_source.sql
-- Firecrawl C1 风险检索：扩展 fetcher_type + seed 默认源（需 FIRECRAWL_API_KEY）

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sources_fetcher_type_check'
      AND conrelid = 'sources'::regclass
  ) THEN
    ALTER TABLE sources DROP CONSTRAINT sources_fetcher_type_check;
  END IF;

  ALTER TABLE sources
    ADD CONSTRAINT sources_fetcher_type_check
    CHECK (fetcher_type IN ('rss', 'html', 'playwright', 'quotes', 'announcement', 'crawl'));
END
$$;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    ('Firecrawl-C1风险检索',
     'https://internal.fe-radar/crawl/c1-risk',
     'crawl',
     '{
       "type": "crawl",
       "adapter": "firecrawl",
       "queries": [
         "远东控股 诉讼",
         "远东电缆 行政处罚",
         "远东智慧能源 质量 抽检",
         "远东 事故 电缆"
       ],
       "limit": 5,
       "country": "CN",
       "location": "China",
       "tbs": "qdr:w",
       "riskFilter": true,
       "entityKeywords": [
         "远东控股",
         "远东电缆",
         "远东智慧能源",
         "远东股份",
         "远东"
       ],
       "riskKeywords": [
         "诉讼",
         "仲裁",
         "判决",
         "处罚",
         "罚款",
         "失信",
         "被执行",
         "事故",
         "质量",
         "抽检",
         "不合格",
         "召回",
         "舆情",
         "负面"
       ],
       "includeDomains": [
         "news.bjx.com.cn",
         "www.cls.cn",
         "finance.sina.com.cn",
         "www.stcn.com",
         "www.gov.cn",
         "www.nea.gov.cn",
         "www.ndrc.gov.cn",
         "www.miit.gov.cn"
       ]
     }'::jsonb,
     'T2', '风险检索', false)

-- 仅首次初始化；admin 启用（enabled=true）后不被重跑 migrate 重新关掉。
-- 如需调整 queries/domains，走一次性显式修复迁移，不要在 seed 里 DO UPDATE。
ON CONFLICT (url) DO NOTHING;

COMMIT;

-- 部署后：在 Portainer 配置 FIRECRAWL_API_KEY，admin 将 enabled 改为 true
