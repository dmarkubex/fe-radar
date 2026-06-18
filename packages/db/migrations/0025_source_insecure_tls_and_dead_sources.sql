-- 0025_source_insecure_tls_and_dead_sources.sql
-- T-SRC-03: per-source opt-in insecureTLS for cableabc; soft-disable dead china-power source.

BEGIN;

UPDATE sources
SET enabled    = false,
    last_error = 'china-power.com.cn 域名 404 下线'
WHERE name = '中国电网 china-power'
  AND url = 'http://www.china-power.com.cn/'
  AND fetcher_type = 'html';

UPDATE sources
SET config     = jsonb_set(config, '{insecureTLS}', 'true'::jsonb, true),
    enabled    = true,
    fail_count = 0,
    last_error = NULL
WHERE name = '电缆网 cableabc'
  AND url = 'https://www.cableabc.com/news/'
  AND fetcher_type = 'html'
  AND config ->> 'type' = 'html';

COMMIT;

-- Rollback:
-- UPDATE sources SET enabled = true WHERE name = '中国电网 china-power' AND url = 'http://www.china-power.com.cn/' AND fetcher_type = 'html';
-- UPDATE sources SET config = config - 'insecureTLS', enabled = false WHERE name = '电缆网 cableabc' AND url = 'https://www.cableabc.com/news/' AND fetcher_type = 'html';
