-- 0019_c2_stock_entities_litigation.sql
-- C1/C2 上市主体 stockCode 写入 entities.meta；新增 C2 竞品分批涉诉公告源

BEGIN;

UPDATE entities
SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('stockCode', stock_code)
FROM (VALUES
    ('远东智慧能源', '600869'),
    ('远东股份', '600869'),
    ('宝胜股份', '600973'),
    ('中天科技', '600522'),
    ('亨通光电', '600487'),
    ('起帆电缆', '605222'),
    ('金杯电工', '002533'),
    ('江西铜业', '600362'),
    ('铜陵有色', '000630'),
    ('云南铜业', '000878'),
    ('宁德时代', '300750'),
    ('比亚迪', '002594'),
    ('亿纬锂能', '300014'),
    ('国轩高科', '002074')
) AS mapping(canonical_name, stock_code)
WHERE entities.type = 'company'
  AND entities.canonical_name = mapping.canonical_name
  -- 仅在尚未设置 stockCode 时填充，避免重跑 migrate 覆盖 admin 后台的修改。
  AND COALESCE(entities.meta->>'stockCode', '') = '';

INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
VALUES
    ('巨潮-C2电缆竞品涉诉',
     'http://www.cninfo.com.cn/new/disclosure/litigation-c2-cable',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"stocks":["600973","600522","600487","605222","002533"],"useRealUa":true,"pageSize":30,"lookbackDays":14}'::jsonb,
     'T1', '上市公司涉诉', true),

    ('巨潮-C2上游涉诉',
     'http://www.cninfo.com.cn/new/disclosure/litigation-c2-upstream',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"stocks":["600362","000630","000878","300750","002594","300014","002074"],"useRealUa":true,"pageSize":30,"lookbackDays":14}'::jsonb,
     'T1', '上市公司涉诉', true)

-- 仅首次初始化；admin 后台对 config/enabled/tier/category 的修改不被重跑 migrate 覆盖。
ON CONFLICT (url) DO NOTHING;

COMMIT;
