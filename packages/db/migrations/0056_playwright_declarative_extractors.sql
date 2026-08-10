-- 0056_playwright_declarative_extractors.sql
-- T-SEC-03: Playwright 源的编辑员可配置 extractor 字符串经 new Function() 执行 = RCE。
-- 此迁移把现存 seed 信源（0004 / 0011）的 config.extractor（JS 字符串）转换成声明式
-- 选择器字段（itemSelector / titleSelector / linkSelector / limit），Worker 侧不再
-- eval 任何编辑员字符串，浏览器侧代码固定。
--
-- 转换规则（覆盖所有已知 extractor 形态）：
--   () => Array.from(document.querySelectorAll('<SEL>')).slice(0,<N>).map(a => ({ title: ..., url: a.href }))
--   → itemSelector='<SEL>', titleSelector='a', linkSelector='a', limit=<N>
--
-- 注意：旧 extractor 用的是 document.querySelectorAll(...)（复数 All），正则必须匹配 All。
-- querySelectorAll? 兼容 querySelector / querySelectorAll 两种写法。
-- 所有正则用 dollar-quoting ($tag$ ... $tag$) 避免单引号转义错配（复核 CRIT-2 修复）。
--
-- 幂等：仅当 config 仍含 'extractor' 键时更新；不带 extractor 的行不动。
-- 不改 fetcher_type（0022 的 html 转换是独立迁移；本迁移只清理 extractor 字段）。
-- 保留 waitFor / useRealUa / listUrl / verificationBlocked* / gate0 等其它字段。
--
-- ROLLBACK (manual only — do not auto-run):
--   无法自动还原 extractor 字符串（已被删除）。如需回滚，从 0004/0011 seed 重建对应行，
--   或恢复 Worker 代码到本迁移之前的版本并手工把 config.extractor 写回。
--   本迁移不修改表结构，仅 UPDATE sources.config jsonb。

BEGIN;

-- 把 extractor 字符串里的 querySelectorAll 选择器和 slice 上限解析出来。
-- extractor 形如: () => Array.from(document.querySelectorAll('SEL')).slice(0,N)...
-- 用正则捕获 SEL 和 N。querySelectorAll? 同时匹配 querySelector / querySelectorAll（旧 seed 全是 All）。
UPDATE sources
SET config = jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    (config - 'extractor'),
                    '{itemSelector}', to_jsonb(substring(config->>'extractor' FROM $re$querySelectorAll?\('([^']+)'\)$re$))
                  ),
                  '{titleSelector}', '"a"'::jsonb
                ),
                '{linkSelector}', '"a"'::jsonb
              ),
              '{limit}', to_jsonb(COALESCE(
                (substring(config->>'extractor' FROM $re$slice\(0,\s*([0-9]+)\)$re$))::int,
                20
              ))
            )
WHERE config ? 'extractor'
  AND config->>'extractor' ~ $re$querySelectorAll?\('([^']+)'\).*slice\(0,\s*[0-9]+\)$re$;

-- 对 extractor 不符合标准形态（无法解析选择器）的行：删 extractor、置空 itemSelector。
-- Worker 对空 itemSelector 显式报错（不 eval），admin 需手工补 itemSelector。
-- 仅处理上一条没动过的行（仍带 extractor）；目前仓库内所有 seed extractor 都命中上面的正则，
-- 此分支是纵深防御，不会在已知 seed 上触发。
UPDATE sources
SET config = jsonb_set((config - 'extractor'), '{itemSelector}', '""'::jsonb)
WHERE config ? 'extractor';

COMMIT;
