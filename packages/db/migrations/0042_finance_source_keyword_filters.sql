-- 0042_finance_source_keyword_filters.sql
-- Narrow broad RSSHub feeds to FE-Radar's power/cable/storage/fiber scope.
--
-- keywordFilter install and source-name renames are intentionally decoupled:
--   1) keywordFilter is installed by URL natural key (stable across admin renames).
--   2) Name renames match the original seed name only — if an admin already renamed
--      a source, their label is respected and not force-overwritten.
--
-- The top-level source URLs remain the historical natural keys while config.url points at
-- broad RSSHub feeds. Only initialize keywordFilter when an admin has not already supplied one.

BEGIN;

-- 1) keywordFilter install — match by URL natural key (idempotent; never overwrite admin filter)
UPDATE sources
SET config = config || '{"keywordFilter":["电力","电网","电缆","电线","输配电","特高压","变压器","储能","能源","光伏","风电","新能源","锂电","锂电池","碳酸锂","铜","有色","稀土","充电桩","电池","电工","远东","光纤","光缆","光通信","光模块","OPGW","ADSS"]}'::jsonb
WHERE url = 'https://36kr.com/information/web_news/'
  AND config->'keywordFilter' IS NULL;

UPDATE sources
SET config = config || '{"keywordFilter":["电力","电网","电缆","电线","输配电","特高压","变压器","储能","能源","光伏","风电","新能源","锂电","锂电池","碳酸锂","铜","有色","稀土","充电桩","电池","电工","远东","光纤","光缆","光通信","光模块","OPGW","ADSS"]}'::jsonb
WHERE url = 'https://www.yicai.com/news/energy/'
  AND config->'keywordFilter' IS NULL;

UPDATE sources
SET config = config || '{"keywordFilter":["电力","电网","电缆","电线","输配电","特高压","变压器","储能","能源","光伏","风电","新能源","锂电","锂电池","碳酸锂","铜","有色","稀土","充电桩","电池","电工","远东","光纤","光缆","光通信","光模块","OPGW","ADSS"]}'::jsonb
WHERE url = 'https://www.jiemian.com/lists/55.html'
  AND config->'keywordFilter' IS NULL;

UPDATE sources
SET config = config || '{"keywordFilter":["电力","电网","电缆","电线","输配电","特高压","变压器","储能","能源","光伏","风电","新能源","锂电","锂电池","碳酸锂","铜","有色","稀土","充电桩","电池","电工","远东","光纤","光缆","光通信","光模块","OPGW","ADSS"]}'::jsonb
WHERE url = 'https://finance.ifeng.com/'
  AND config->'keywordFilter' IS NULL;

-- 2) source-name renames — match by original seed name only (respect admin renames)
UPDATE sources
SET name = '36氪 快讯（全站）'
WHERE name = '36氪 新能源'
  AND url = 'https://36kr.com/information/web_news/';

UPDATE sources
SET name = '第一财经 头条（全站）'
WHERE name = '第一财经 能源'
  AND url = 'https://www.yicai.com/news/energy/';

-- 0031 used the non-existent seed name "凤凰财经-能源". Cover both historical names so either
-- residual label is normalized when still present; admin-chosen other names are left alone.
UPDATE sources
SET name = '凤凰财经 能源'
WHERE name IN ('凤凰财经 能源', '凤凰财经-能源')
  AND url = 'https://finance.ifeng.com/';

COMMIT;

-- Rollback (manual):
-- UPDATE sources SET name='36氪 新能源', config=config-'keywordFilter'
-- WHERE name='36氪 快讯（全站）' AND url='https://36kr.com/information/web_news/';
-- UPDATE sources SET name='第一财经 能源', config=config-'keywordFilter'
-- WHERE name='第一财经 头条（全站）' AND url='https://www.yicai.com/news/energy/';
-- UPDATE sources SET config=config-'keywordFilter'
-- WHERE url='https://www.jiemian.com/lists/55.html';
-- UPDATE sources SET config=config-'keywordFilter'
-- WHERE name='凤凰财经 能源' AND url='https://finance.ifeng.com/';
