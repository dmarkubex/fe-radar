-- 0021_litigation_title_keywords_backfill.sql
-- 仅为已存在的涉诉公告 seed 源补齐 titleKeywords；不覆盖 admin 已配置的关键词。

BEGIN;

UPDATE sources
SET config = config || jsonb_build_object(
  'titleKeywords',
  '["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"]'::jsonb
)
WHERE fetcher_type = 'announcement'
  AND category = '上市公司涉诉'
  AND config->>'litigationFilter' = 'true'
  AND config->'titleKeywords' IS NULL
  AND url IN (
    'http://www.cninfo.com.cn/new/disclosure/litigation',
    'http://www.szse.cn/disclosure/listed/litigation',
    'http://www.cninfo.com.cn/new/disclosure/litigation-c2-cable',
    'http://www.cninfo.com.cn/new/disclosure/litigation-c2-upstream'
  );

COMMIT;
