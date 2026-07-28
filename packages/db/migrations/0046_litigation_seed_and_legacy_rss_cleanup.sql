-- 0046_litigation_seed_and_legacy_rss_cleanup.sql
-- P2：补 0018/0019 四条涉诉信源 seed（生产 MIGRATION_BASELINE 未真跑）+ 清理零引用 (legacy-rss) 重复行
--
-- 背景：生产 schema_migrations 的 0001–0037 同秒 applied_at = MIGRATION_BASELINE 签名，
-- 只写账本不执行 SQL，故 0018/0019 的 INSERT 从未落地；ledger 已有记录后不会再重跑。
-- 只能写新前向迁移补缺。
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 任务 A — 四条涉诉源（逐字照抄 0018/0019 的 name/url/fetcher_type/config/tier/category）
-- 唯一改动：enabled 一律 false（从未在任何环境 smoke 通过，禁止默认启用上生产；
-- admin 在 adapter smoke 通过后再手工打开）。
--
-- ── P2 返修（P2-1 HIGH）：ON CONFLICT 不再无条件 DO NOTHING ────────────────
-- 全新库走完 0018/0019 后四行已存在且 enabled=true；旧版 0046 撞 url 后 0 插入，
-- 四行继续 enabled=true，fetch 只挡 enabled=false → 本迁移唯一存在理由在全新环境失效。
-- 修法：
--   · baseline 生产缺行 → INSERT enabled=false
--   · 已有行且仍精确等于 0018/0019 原始 seed 指纹（name/fetcher_type/config/tier/category）
--     且无 admin 痕迹 → 仅把 enabled 收敛为 false，其余列不动
--   · 指纹任一列不同，或 admin_touched_at 非空，或 admin_snapshot 含 enabled 键
--     → 保持原样不碰（preserved_conflict）
--   · 指纹齐全且无 admin 痕迹、但 enabled 已是 false
--     → already_converged（幂等重跑常见；不是冲突，勿计入 preserved_conflict）
-- 守卫列写入方复核（grep *.ts）：admin_touched_at / admin_snapshot 仅由
-- packages/db/src/repos/sources.ts#updateSource 在 admin 改字段时写入；
-- 本迁移只读守卫，不写这两列。0018/0019 原始 seed 行两列均为 NULL。
-- NOTICE 报告 inserted / reconciled / already_converged / preserved_conflict。
--
-- ── adapter config 键 grep 复核（实现时自行核验，不抄主持者旧结论）──────────
-- 路径：apps/worker/src/fetchers/announcements/{cninfo,szse,litigation-filter}.ts
--
-- 1) litigationFilter
--    cninfo.ts / szse.ts 正文均不直接读该键；仅 litigation-filter.ts:resolveTitleKeywords
--    在 titleKeywords 与 searchkey 都缺失且 litigationFilter===true 时 throw。
--    本 seed 四条均带 titleKeywords，运行时永远到不了该分支 → 当前为死配置键。
--    仍照抄保留（与 0018/0019 一致），不在本批次改 config 形状。
--
-- 2) titleKeywords
--    cninfo.ts 与 szse.ts 均经 resolveTitleKeywords + filterItemsByTitleKeywords 消费
--    （szse.ts fetch 末尾：filterItemsByTitleKeywords(items, resolveTitleKeywords(config))）。
--    主持者简报曾写「szse 不消费 titleKeywords」——以当前代码为准，该结论已过时。
--    因此「深交所-涉诉公告」启用后会做标题关键词过滤，不是全量公告无过滤。
--    仍默认 enabled=false：整批涉诉源统一 smoke-first，不因过滤可用就默认打开。
--
-- 3) cninfo 其余键
--    stocks / searchkey / lookbackDays / pageSize 均在 cninfo.ts 有对应读取；
--    三条 cninfo 源（涉诉公告 / C2电缆竞品涉诉 / C2上游涉诉）config 键均有实现。
--    szse 消费 stocks（及 stock/stockCode/secCode 别名）/ pageSize（buildSzseRequestBody）。
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 任务 B — 删除 name 含 '(legacy-rss)' 的重复行
-- 不按 id 删（生产特有 id，新库无这些行）。按 name LIKE '%(legacy-rss)%' 匹配。
--
-- FK 引用方（migrations + schema 全仓核验，仅此两处 REFERENCES sources(id)）：
--   · items.source_id            — 0001_init.sql / schema.ts
--   · commodity_quotes.source_id — 0008_commodity_briefing.sql / schema-commodity.ts
-- 对上述每一张表加 NOT EXISTS 零引用守卫：有引用则跳过该行（不是整迁移失败）。
-- RAISE NOTICE 报告 deleted / skipped_referenced。
-- 新库零行：幂等、不报错。
--
-- 可观测性：
--   · 任务 A 用 TEMP 表 _m0046_litigation_counts（INSERT+条件 UPDATE+已收敛计数均在 CTE 内，
--     是普通 SQL，不是 DO 块）记录 inserted/reconciled/already_converged；
--     NOTICE 再算 preserved_conflict = total - inserted - reconciled - already_converged。
--     幂等重跑：已为 false 的合格指纹行进 already_converged，不得进 preserved_conflict。
--   · 任务 B 用 TEMP 表保留候选，NOTICE 报告 deleted / skipped_referenced。
--
-- e2e 注意：MIGRATION_PROFILE=e2e 会剥离 DO $$ ... $$ 块（仅丢 NOTICE），
-- INSERT / 条件 UPDATE / DELETE 本体是普通 SQL，剥离后仍执行，不会静默跳过收敛或清理。
--
-- ── P2-2（MEDIUM）Rollback 策略 ──────────────────────────────────────────
-- 选择：前向恢复 / 按备份人工处置（删除伪 rollback DELETE 块）。
-- 理由：旧注释按四 URL 无条件 DELETE 不是 0046 的逆操作——
--   · 全新链上 0046 可能一行都没插（仅把 0018/0019 行 enabled 收敛为 false），
--     按 URL DELETE 会误删 0018/0019 创建的行（评审实测 DELETE 4）；
--   · 生产上 admin 若已 smoke 并启用维护过这些行，同样会删掉 admin 数据；
--   · legacy-rss 行本就不在迁移链内，DELETE 后无法从本文件恢复。
-- 若需回退：从部署前备份还原 sources（及必要 FK）；禁止按 URL 无条件 DELETE。
--
-- 不改 0001–0045；不改 adapter / worker / web。

BEGIN;

-- ── A. 四条涉诉源：补缺 INSERT + 仅收敛未触碰的原始 seed 指纹行 ──────────
-- CTE 同语句共享 snapshot（PG 数据修改 CTE 互不可见对目标表的写效果）：
--   · INSERT 只返回新行；UPDATE 只命中迁移前已存在且仍 enabled≠false 的行
--   · already CTE 读同一 snapshot，只见迁移前已是 enabled=false 的合格指纹行
--     （新插入行在 snapshot 中尚不存在；即将 reconciled 的行仍是 true）
-- 新插入行已是 enabled=false，无需（也不可见）再 UPDATE。
CREATE TEMP TABLE _m0046_litigation_counts ON COMMIT DROP AS
WITH seed (name, url, fetcher_type, config, tier, category) AS (
  VALUES
    ('巨潮-涉诉公告',
     'http://www.cninfo.com.cn/new/disclosure/litigation',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"useRealUa":true,"pageSize":30}'::jsonb,
     'T1', '上市公司涉诉'),

    ('深交所-涉诉公告',
     'http://www.szse.cn/disclosure/listed/litigation',
     'announcement',
     '{"type":"announcement","adapter":"szse","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"useRealUa":true,"pageSize":50}'::jsonb,
     'T1', '上市公司涉诉'),

    ('巨潮-C2电缆竞品涉诉',
     'http://www.cninfo.com.cn/new/disclosure/litigation-c2-cable',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"stocks":["600973","600522","600487","605222","002533"],"useRealUa":true,"pageSize":30,"lookbackDays":14}'::jsonb,
     'T1', '上市公司涉诉'),

    ('巨潮-C2上游涉诉',
     'http://www.cninfo.com.cn/new/disclosure/litigation-c2-upstream',
     'announcement',
     '{"type":"announcement","adapter":"cninfo","searchkey":"诉讼","titleKeywords":["诉讼","仲裁","判决","裁定","涉诉","起诉","应诉"],"litigationFilter":true,"stocks":["600362","000630","000878","300750","002594","300014","002074"],"useRealUa":true,"pageSize":30,"lookbackDays":14}'::jsonb,
     'T1', '上市公司涉诉')
),
ins AS (
  INSERT INTO sources (name, url, fetcher_type, config, tier, category, enabled)
  SELECT name, url, fetcher_type, config, tier, category, false
  FROM seed
  ON CONFLICT (url) DO NOTHING
  RETURNING url
),
rec AS (
  UPDATE sources s
  SET enabled = false
  FROM seed
  WHERE s.url = seed.url
    AND s.enabled IS DISTINCT FROM false
    -- 原始 seed 指纹：任一列被改过 → 不收敛
    AND s.name IS NOT DISTINCT FROM seed.name
    AND s.fetcher_type IS NOT DISTINCT FROM seed.fetcher_type
    AND s.config IS NOT DISTINCT FROM seed.config
    AND s.tier IS NOT DISTINCT FROM seed.tier
    AND s.category IS NOT DISTINCT FROM seed.category
    -- admin 痕迹：updateSource 写 admin_touched_at；显式改 enabled 还会写 snapshot.enabled
    AND s.admin_touched_at IS NULL
    AND NOT COALESCE(s.admin_snapshot ? 'enabled', false)
  RETURNING s.url
),
-- 已收敛：迁移前已是 enabled=false 且指纹/守卫与 rec 相同（仅缺「仍需改 enabled」）。
-- 与 rec 共用同一 snapshot，故不会把本语句刚收敛的行算进来；新插入行也不可见。
already AS (
  SELECT s.url
  FROM sources s
  INNER JOIN seed ON s.url = seed.url
  WHERE s.enabled IS NOT DISTINCT FROM false
    AND s.name IS NOT DISTINCT FROM seed.name
    AND s.fetcher_type IS NOT DISTINCT FROM seed.fetcher_type
    AND s.config IS NOT DISTINCT FROM seed.config
    AND s.tier IS NOT DISTINCT FROM seed.tier
    AND s.category IS NOT DISTINCT FROM seed.category
    AND s.admin_touched_at IS NULL
    AND NOT COALESCE(s.admin_snapshot ? 'enabled', false)
)
SELECT
  (SELECT count(*)::int FROM seed) AS total,
  (SELECT count(*)::int FROM ins) AS inserted,
  (SELECT count(*)::int FROM rec) AS reconciled,
  (SELECT count(*)::int FROM already) AS already_converged;

DO $$ BEGIN
  RAISE NOTICE '0046 litigation seed: inserted=%, reconciled=%, already_converged=%, preserved_conflict=%',
    (SELECT inserted FROM _m0046_litigation_counts),
    (SELECT reconciled FROM _m0046_litigation_counts),
    (SELECT already_converged FROM _m0046_litigation_counts),
    (SELECT total - inserted - reconciled - already_converged FROM _m0046_litigation_counts);
END $$;

-- ── B. 零引用 (legacy-rss) 清理 ───────────────────────────────────────────
-- TEMP 先冻结候选 + 引用状态，DELETE 后仍可 NOTICE 计数（幂等：候选为空时 deleted=0）
CREATE TEMP TABLE _m0046_legacy_rss ON COMMIT DROP AS
SELECT
  s.id,
  s.name,
  (
    EXISTS (SELECT 1 FROM items i WHERE i.source_id = s.id)
    OR EXISTS (SELECT 1 FROM commodity_quotes cq WHERE cq.source_id = s.id)
  ) AS has_ref
FROM sources s
WHERE s.name LIKE '%(legacy-rss)%';

DELETE FROM sources s
USING _m0046_legacy_rss t
WHERE s.id = t.id
  AND t.has_ref = false;

DO $$ BEGIN
  RAISE NOTICE '0046 legacy-rss cleanup: deleted=%, skipped_referenced=%',
    (SELECT count(*) FROM _m0046_legacy_rss WHERE has_ref = false),
    (SELECT count(*) FROM _m0046_legacy_rss WHERE has_ref = true);
END $$;

COMMIT;
