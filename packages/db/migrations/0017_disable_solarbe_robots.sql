-- 0017_disable_solarbe_robots.sql
-- 索比光伏网（url = https://www.solarbe.com/news/）：
--   - robots.txt Disallow: /news/（worker 报 "robots.txt disallows /news/"，
--     按项目合规底线「代理池不得绕 robots.txt」，必须停抓）
--   - 历史多次 smoke 回归 0 items（0014 selector 失效），线上库该信源实际 enabled=true
-- 本迁移幂等：migrate 脚本会重跑全部 *.sql，故每次执行都把 enabled 置 false
-- （同 0015 的 UPDATE 重跑语义；WHERE 精确匹配 url，无副作用）。
-- 待 selector 刷新或 Playwright 跟进、且确认 robots.txt 放行后再手工启用。

BEGIN;

-- 幂等：精确匹配 url，重复执行结果一致
UPDATE sources SET enabled = false WHERE url = 'https://www.solarbe.com/news/';

COMMIT;

-- Rollback (manual; re-enable only after robots.txt permits /news/ and selector verified):
-- UPDATE sources SET enabled = true WHERE url = 'https://www.solarbe.com/news/';
