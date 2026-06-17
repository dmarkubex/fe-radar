-- 0018_litigation_sources_seed.sql
-- 涉诉公告专用信源：巨潮关键词检索 + 深交所列表后标题过滤

BEGIN;

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    ('巨潮-涉诉公告',
     'http://www.cninfo.com.cn/new/disclosure/litigation',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"useRealUa":true,"pageSize":30}'::jsonb,
     'T1', '上市公司涉诉', true),

    ('深交所-涉诉公告',
     'http://www.szse.cn/disclosure/listed/litigation',
     'announcement',
     '{"type":"announcement","adapter":"szse","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"useRealUa":true,"pageSize":50}'::jsonb,
     'T1', '上市公司涉诉', true)

-- 仅首次初始化；admin 后台对 config/enabled/tier/category 的修改不被重跑 migrate 覆盖。
-- 如需调整既有源，走一次性显式修复迁移，不要在 seed 里 DO UPDATE。
ON CONFLICT (url) DO NOTHING;

COMMIT;
