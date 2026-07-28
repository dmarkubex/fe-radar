-- 0045_seed_circle_entities.sql
-- 关注圈 C1/C2 实体字典 seed（修复 top_circle 全表恒为 C3 的生产缺陷）
--
-- 根因：entities 表从 M0 起从未 seed C1/C2 词典，circle 全 NULL；
--       0019 仅 UPDATE stockCode（假设实体已存在）→ 静默命中 0 行。
-- 权威名单：spec/requirements.md §5.1（C1 核心圈）/ §5.2（C2 战略圈·竞品+关键上游）。
--
-- ── 省网归类（F1 返修）────────────────────────────────────────────────────
-- 实现选择 (a)：把 27 家国网省公司 + 5 家南网省公司写进「国家电网」「南方电网」
-- 的 aliases，不单列为独立 company 行。
-- 理由：① §5.1 原文「国家电网、南方电网（含 27 家省网）」把省网语义上归属两大总部；
--       ② 省网名多、新闻写法杂（「国网江苏省电力有限公司」/「江苏省电力有限公司」），
--          作 aliases 命中后 resolveEntityId 落到总部实体，circle=C1 一次到位；
--       ③ 避免 32 行独立实体与总部重复命中时的 top_circle 噪声。
-- 规格矛盾（显式记录，禁止后续实现者按 §5.2 改回 C2）：
--   · §5.1 核心客户：「国家电网、南方电网（含 27 家省网）」→ 省网属 C1
--   · §5.2 关键下游：「国网各省公司（按省份单列）」→ 像是 C2 且单列
-- 本迁移**依据 §5.1 归 C1**（省网是电缆行业最直接客户，C1 漏报代价远高于 C2 过召）。
-- §5.2 其余下游（房企 / EPC / 储能集成商）本批仍不 seed，留给独立批次或 admin 补录。
--
-- ── ON CONFLICT 条件补齐（F2 返修）────────────────────────────────────────
-- 不再 DO NOTHING：同名 type+canonical 若已存在且 circle IS NULL，条件 UPDATE 补齐
-- circle，并只补 aliases / meta 的缺失值，不覆盖 admin 已设值。
-- 生产实测（主持者 2026-07-28）：现有 company 仅 2 行测试垃圾，与 28 个 seed 名
-- 无一相撞，故「同名 company + circle NULL」当前不会触发；但仍必须修，防止静默失效。
--
-- ── 国家能源局 policy/company 同名并存（F2 判断，不删除）──────────────────
-- 生产已有 type='policy'、canonical_name='国家能源局'、circle=NULL 一行。
-- UNIQUE 约束是 (type, canonical_name)，本迁移插 type='company' 同行名 → 不冲突，
-- 会与 policy 行并存。判断：无害。
--   · resolveEntityId(type, name) 按 type 分别解析，policy 与 company 各走各的；
--   · 关注圈 / D2 走 company 路径，company/C1 行生效；policy 行继续服务政策编号 NER。
--   · 禁止 DELETE 已有 policy 行（审计与既有 item_entities FK 风险）。
--
-- 硬约束：
-- 1. type='company'：监管机构/五大发电亦用 company——关注圈命中与 NER resolveEntityId
--    的 company 路径一致（§8 company 类承载关注圈命中；policy 专用于政策编号）。
-- 2. 0019 UPDATE 用到的 14 个 canonical_name 必须逐字一致，并在 meta 写入 stockCode，
--    补上 0019 因实体缺失而静默 0 行的回填（0019 有 ledger 后不会再跑）。
-- 3. aliases 填 requirements 括号内别名 + OWN 同义词 + 省网全称（见上），
--    供 resolveEntityId 的 aliases @> ARRAY[name] 分支命中。
-- 4. ON CONFLICT (type, canonical_name) DO UPDATE … WHERE circle IS NULL ——
--    仅补齐空 circle；admin 已设 circle 的行跳过（RAISE NOTICE 报告跳过数）。
-- 5. 不改 0001–0044；不改 NER / pickTopCircle；不做存量 item_analysis 回填。
-- 6. DO $$ NOTICE 在 MIGRATION_PROFILE=e2e 下由 toRunnableSql 剥离；INSERT 本体保留。

BEGIN;

-- xmax=0 → 新插入；xmax≠0 → 条件 UPDATE 命中。冲突且 circle 非空时 WHERE 挡掉，不进 RETURNING。
CREATE TEMP TABLE _m0045_upsert ON COMMIT DROP AS
WITH seed (type, canonical_name, aliases, circle, weight, meta) AS (
  VALUES
    -- ── §5.1 C1 核心圈 · 自家公司 ──────────────────────────────────────────
    ('company', '远东控股集团',
     ARRAY['远东控股']::text[],
     'C1', 1.0, NULL),
    ('company', '远东电缆',
     ARRAY[]::text[],
     'C1', 1.0, NULL),
    -- 0019 stockCode 对齐（canonical_name 必须逐字 = '远东智慧能源'）
    ('company', '远东智慧能源',
     ARRAY['远东智慧']::text[],
     'C1', 1.0, '{"stockCode":"600869"}'::jsonb),
    ('company', '远东智慧能源股份',
     ARRAY[]::text[],
     'C1', 1.0, NULL),
    -- 0019 stockCode 对齐（canonical_name 必须逐字 = '远东股份'）
    ('company', '远东股份',
     ARRAY[]::text[],
     'C1', 1.0, '{"stockCode":"600869"}'::jsonb),

    -- ── §5.1 C1 核心圈 · 核心客户（含 27 家国网省网 + 5 家南网省网 aliases）──
    ('company', '国家电网',
     ARRAY[
       '国网',
       '国家电网有限公司',
       -- 国网 27 家省级电力公司（§5.1 C1；非 §5.2 C2）
       '国网北京市电力公司',
       '国网天津市电力公司',
       '国网河北省电力有限公司',
       '国网冀北电力有限公司',
       '国网山西省电力公司',
       '国网山东省电力公司',
       '国网上海市电力公司',
       '国网江苏省电力有限公司',
       '江苏省电力有限公司',
       '国网浙江省电力有限公司',
       '浙江省电力有限公司',
       '国网安徽省电力有限公司',
       '国网福建省电力有限公司',
       '国网湖北省电力有限公司',
       '国网湖南省电力有限公司',
       '国网河南省电力公司',
       '国网江西省电力有限公司',
       '国网四川省电力公司',
       '国网重庆市电力公司',
       '国网辽宁省电力有限公司',
       '国网吉林省电力有限公司',
       '国网黑龙江省电力有限公司',
       '国网内蒙古东部电力有限公司',
       '国网蒙东电力',
       '国网陕西省电力有限公司',
       '国网甘肃省电力公司',
       '国网青海省电力公司',
       '国网宁夏电力有限公司',
       '国网新疆电力有限公司',
       '国网西藏电力有限公司'
     ]::text[],
     'C1', 1.0, NULL),
    ('company', '南方电网',
     ARRAY[
       '南网',
       '中国南方电网',
       -- 南网 5 家省级电网公司（§5.1 C1）
       '广东电网有限责任公司',
       '广西电网有限责任公司',
       '云南电网有限责任公司',
       '贵州电网有限责任公司',
       '海南电网有限责任公司'
     ]::text[],
     'C1', 1.0, NULL),

    -- ── §5.1 C1 核心圈 · 直接监管（type=company：关注圈词典路径，非 policy 编号）──
    -- 注意：生产可能已有 type=policy 的「国家能源局」行（circle NULL）；本行 type=company，
    -- 与之并存，不删除 policy 行（见文件头 F2 判断）。
    ('company', '国家能源局',
     ARRAY['能源局']::text[],
     'C1', 1.0, NULL),
    ('company', '国家发改委',
     ARRAY['发改委','国家发展和改革委员会']::text[],
     'C1', 1.0, NULL),
    ('company', '工信部',
     ARRAY['工业和信息化部']::text[],
     'C1', 1.0, NULL),

    -- ── §5.1 C1 核心圈 · 五大发电集团 ──────────────────────────────────────
    ('company', '国家电投',
     ARRAY['国家电力投资集团','国家电力投资集团有限公司']::text[],
     'C1', 1.0, NULL),
    ('company', '华能',
     ARRAY['中国华能','华能集团','中国华能集团']::text[],
     'C1', 1.0, NULL),
    ('company', '华电',
     ARRAY['中国华电','华电集团','中国华电集团']::text[],
     'C1', 1.0, NULL),
    ('company', '大唐',
     ARRAY['中国大唐','大唐集团','中国大唐集团']::text[],
     'C1', 1.0, NULL),
    ('company', '国家能源集团',
     ARRAY['国能集团','国家能源投资集团']::text[],
     'C1', 1.0, NULL),

    -- ── §5.2 C2 战略圈 · 主要竞品（电缆）──────────────────────────────────
    -- 0019 stockCode 对齐
    ('company', '宝胜股份',
     ARRAY['宝胜电缆']::text[],
     'C2', 1.0, '{"stockCode":"600973"}'::jsonb),
    ('company', '江南电缆',
     ARRAY['江苏江南电缆']::text[],
     'C2', 1.0, NULL),
    ('company', '中天科技',
     ARRAY['中天电缆','中天海缆']::text[],
     'C2', 1.0, '{"stockCode":"600522"}'::jsonb),
    ('company', '亨通光电',
     ARRAY['亨通电缆','亨通海缆']::text[],
     'C2', 1.0, '{"stockCode":"600487"}'::jsonb),
    ('company', '起帆电缆',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"605222"}'::jsonb),
    ('company', '金杯电工',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"002533"}'::jsonb),

    -- ── §5.2 C2 战略圈 · 关键上游 ──────────────────────────────────────────
    ('company', '江西铜业',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"600362"}'::jsonb),
    ('company', '铜陵有色',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"000630"}'::jsonb),
    ('company', '云南铜业',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"000878"}'::jsonb),
    ('company', '宁德时代',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"300750"}'::jsonb),
    ('company', '比亚迪',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"002594"}'::jsonb),
    ('company', '亿纬锂能',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"300014"}'::jsonb),
    ('company', '国轩高科',
     ARRAY[]::text[],
     'C2', 1.0, '{"stockCode":"002074"}'::jsonb)
),
upserted AS (
  INSERT INTO entities (type, canonical_name, aliases, circle, weight, meta)
  SELECT type, canonical_name, aliases, circle, weight, meta
  FROM seed
  WHERE true
  ON CONFLICT (type, canonical_name) DO UPDATE SET
    -- 仅当原 circle 为空时写入 seed 的 circle（不覆盖 admin 已设值）
    circle = EXCLUDED.circle,
    -- 保留原 aliases 顺序，只追加 seed 中尚不存在的别名
    aliases = COALESCE(entities.aliases, ARRAY[]::text[]) || ARRAY(
      SELECT seed_alias
      FROM unnest(EXCLUDED.aliases) AS seeded(seed_alias)
      WHERE NOT seed_alias = ANY (COALESCE(entities.aliases, ARRAY[]::text[]))
    ),
    -- seed 仅补缺失键；右侧原 meta 的同名键优先，不覆盖 admin 值
    meta = CASE
      WHEN EXCLUDED.meta IS NULL THEN entities.meta
      ELSE EXCLUDED.meta || COALESCE(entities.meta, '{}'::jsonb)
    END
  WHERE entities.circle IS NULL
  RETURNING (xmax = 0) AS was_insert
)
SELECT
  (SELECT count(*) FROM seed) AS total,
  count(*) FILTER (WHERE was_insert) AS inserted,
  count(*) FILTER (WHERE NOT was_insert) AS updated_null_circle
FROM upserted;

-- 非静默：插入 / 条件更新 / 因 circle 非空而跳过 一眼可见（e2e 会剥离本块）
DO $$ BEGIN
  RAISE NOTICE '0045 seed circle entities: inserted=%, updated_null_circle=%, skipped_existing_nonnull_circle=%',
    (SELECT inserted FROM _m0045_upsert),
    (SELECT updated_null_circle FROM _m0045_upsert),
    (SELECT total - inserted - updated_null_circle FROM _m0045_upsert);
END $$;

COMMIT;
