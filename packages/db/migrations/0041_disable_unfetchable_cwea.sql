-- 0041_disable_unfetchable_cwea.sql
-- Reconcile T-REL-05 with the migration chain:
--   * 0023 already moved CPIA and escn from their 404 subpaths to live home pages.
--   * CWEA still relies on news_lastest.js, which the HTML fetcher cannot parse.
--
-- Keep CWEA soft-disabled and preserve the row for historical FK references. Replacement
-- sources remain a separate human selection after robots and deployment-network smoke.
--
-- Deliberate narrow exception to the normal admin_snapshot/admin_touched_at migration guard:
-- this is a safety-disable migration for a technically unfetchable source, so it must override
-- an admin-set enabled=true. It does not alter config; only enabled and the explanatory
-- last_error are forced.

BEGIN;

-- last_error_at is deliberately left untouched: it records when the source actually last failed,
-- which is real observability. Overwriting it with NULL (or a fabricated now()) would erase that
-- signal in exchange for nothing -- this migration is a review decision, not a new fetch failure.
UPDATE sources
SET enabled = false,
    last_error = '2026-07-27 复核：news_lastest.js 动态注入，HTML fetcher 无法解析；等待人工确认替代信源'
WHERE url = 'http://www.cwea.org.cn/news.html';

DO $$ BEGIN
  RAISE NOTICE '0041 CWEA safety-disable result: disabled_rows=%, admin_touched_rows=%',
    (SELECT count(*) FROM sources
      WHERE url = 'http://www.cwea.org.cn/news.html'
      AND enabled = false
      AND last_error = '2026-07-27 复核：news_lastest.js 动态注入，HTML fetcher 无法解析；等待人工确认替代信源'),
    (SELECT count(*) FROM sources
      WHERE url = 'http://www.cwea.org.cn/news.html'
      AND admin_touched_at IS NOT NULL
      AND enabled = false
      AND last_error = '2026-07-27 复核：news_lastest.js 动态注入，HTML fetcher 无法解析；等待人工确认替代信源');
END $$;

COMMIT;

-- Rollback (manual, only after adding a compatible adapter):
-- UPDATE sources SET enabled=true, last_error=NULL
-- WHERE url='http://www.cwea.org.cn/news.html';
