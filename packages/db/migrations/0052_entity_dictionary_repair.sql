-- 0052_entity_dictionary_repair.sql
-- 补齐已启用竞品/下游官方源对应的 C2 实体，并按生产核实指纹清理两个测试实体。
-- 回滚：部署前导出测试实体及 item_entities；新增实体仅在无引用时按 canonical_name 删除。

BEGIN;

CREATE TEMP TABLE _m0052_upsert ON COMMIT DROP AS
WITH seed (type, canonical_name, aliases, circle) AS (
  VALUES
    ('company', '东方电缆', ARRAY['宁波东方电缆']::text[], 'C2'),
    ('company', '中国电建', ARRAY['中国电力建设集团', 'POWERCHINA']::text[], 'C2'),
    ('company', '阳光电源', ARRAY['Sungrow']::text[], 'C2'),
    ('company', '华为数字能源', ARRAY['Huawei Digital Power', 'Huawei']::text[], 'C2'),
    ('company', '海博思创', ARRAY['HyperStrong']::text[], 'C2'),
    ('company', 'Nexans', ARRAY['Nexans Group']::text[], 'C2'),
    ('company', '万科', ARRAY['万科企业', '万科集团']::text[], 'C2'),
    ('company', '保利', ARRAY['保利发展', '保利地产']::text[], 'C2'),
    ('company', '华润置地', ARRAY['华润置地有限公司']::text[], 'C2'),
    ('company', '龙湖', ARRAY['龙湖集团']::text[], 'C2'),
    ('company', '绿地', ARRAY['绿地控股', '绿地集团']::text[], 'C2'),
    ('company', '明阳智能', ARRAY['明阳智慧能源', 'MingYang']::text[], 'C2'),
    ('company', '中国能建', ARRAY['中国能源建设集团', 'CEEC']::text[], 'C2'),
    ('company', '科华数能', ARRAY['科华数据', 'Kehua Tech']::text[], 'C2')
),
upserted AS (
  INSERT INTO entities (type, canonical_name, aliases, circle)
  SELECT type, canonical_name, aliases, circle
  FROM seed
  ON CONFLICT (type, canonical_name) DO UPDATE SET
    circle = COALESCE(entities.circle, EXCLUDED.circle),
    aliases = COALESCE(entities.aliases, ARRAY[]::text[]) || ARRAY(
      SELECT seed_alias
      FROM unnest(EXCLUDED.aliases) AS seeded(seed_alias)
      WHERE NOT seed_alias = ANY (COALESCE(entities.aliases, ARRAY[]::text[]))
    )
  WHERE entities.circle IS NULL
     OR EXISTS (
       SELECT 1
       FROM unnest(EXCLUDED.aliases) AS seeded(seed_alias)
       WHERE NOT seed_alias = ANY (COALESCE(entities.aliases, ARRAY[]::text[]))
     )
  RETURNING (xmax = 0) AS was_insert
)
SELECT
  (SELECT count(*) FROM seed) AS total,
  count(*) FILTER (WHERE was_insert) AS inserted,
  count(*) FILTER (WHERE NOT was_insert) AS updated_existing
FROM upserted;

DO $$ BEGIN
  RAISE NOTICE '0052 entity dictionary: inserted=%, updated_existing=%, skipped_unchanged=%',
    (SELECT inserted FROM _m0052_upsert),
    (SELECT updated_existing FROM _m0052_upsert),
    (SELECT total - inserted - updated_existing FROM _m0052_upsert);
END $$;

-- 完整指纹来自 2026-08-04 生产只读复核；不依赖跨环境不稳定的实体 id。
CREATE TEMP TABLE _m0052_test_entity_candidates ON COMMIT DROP AS
SELECT id
FROM entities
WHERE (
    type = 'company'
    AND canonical_name = '测试实体'
    AND aliases = ARRAY['测试', 'test']::text[]
    AND circle IS NULL
    AND weight = 1.0
    AND meta IS NULL
  ) OR (
    type = 'company'
    AND canonical_name = '测试公司_Test2026'
    AND aliases = ARRAY['测试别名', 'TestAlias']::text[]
    AND circle IS NULL
    AND weight = 1.0
    AND meta IS NULL
  );

-- entity_financials 是 ON DELETE CASCADE；存在财务数据时 fail closed，实体及关联均保留。
CREATE TEMP TABLE _m0052_test_entities ON COMMIT DROP AS
SELECT entities.id
FROM entities
INNER JOIN _m0052_test_entity_candidates candidate ON candidate.id = entities.id
WHERE NOT EXISTS (
  SELECT 1
  FROM entity_financials ef
  WHERE ef.entity_id = entities.id
);

CREATE TEMP TABLE _m0052_deleted_links ON COMMIT DROP AS
WITH deleted AS (
  DELETE FROM item_entities
  WHERE entity_id IN (SELECT id FROM _m0052_test_entities)
  RETURNING 1
)
SELECT count(*) AS count FROM deleted;

CREATE TEMP TABLE _m0052_deleted_entities ON COMMIT DROP AS
WITH deleted AS (
  DELETE FROM entities
  WHERE id IN (SELECT id FROM _m0052_test_entities)
  RETURNING 1
)
SELECT count(*) AS count FROM deleted;

DO $$ BEGIN
  RAISE NOTICE '0052 test entity cleanup: item_entity_links=%, entities=%, skipped_financial=%',
    (SELECT count FROM _m0052_deleted_links),
    (SELECT count FROM _m0052_deleted_entities),
    (SELECT count(*) FROM _m0052_test_entity_candidates) -
      (SELECT count(*) FROM _m0052_test_entities);
END $$;

COMMIT;
