-- 0031: 给「凤凰财经-能源」RSS 信源添加关键词白名单（幂等，不覆盖 admin 已改动的值）
UPDATE sources
SET config = config || '{"keywordFilter":["电力","电网","电缆","电线","输配电","特高压","变压器","储能","能源","光伏","风电","新能源","锂电","锂电池","碳酸锂","铜","有色","稀土","充电桩","电池","电工","远东"]}'::jsonb
WHERE name = '凤凰财经-能源'
  AND (config->'keywordFilter') IS NULL;
