-- 0026_ensure_crawl_source_backfill.sql
-- 幂等补种：部署若用了旧 migrate 镜像漏跑 0020/0024，重跑本文件即可补出 crawl 源并启用。
-- 不覆盖 admin 已改过的 config（INSERT ON CONFLICT DO NOTHING）；仅 reset fail_count/last_error。

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
     'T2', '风险检索', true)
ON CONFLICT (url) DO NOTHING;

UPDATE sources
SET enabled    = true,
    fail_count = 0,
    last_error = NULL
WHERE name = 'Firecrawl-C1风险检索'
  AND fetcher_type = 'crawl';

COMMIT;

-- Rollback: UPDATE sources SET enabled = false WHERE name = 'Firecrawl-C1风险检索';