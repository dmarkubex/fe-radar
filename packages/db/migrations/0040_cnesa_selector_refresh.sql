-- 0040_cnesa_selector_refresh.sql
-- CNESA is reachable and robots.txt allows crawling. The old generic "a" selector picked an
-- image-overlay anchor with no text, so fetchHtml discarded every article. Verified 2026-07-27
-- with the production fetcher: title/link/content selectors below resolve 12 real
-- storage-industry items.
--
-- Re-verified 2026-07-28 against production: the list page has NO per-item date element at all --
-- no ".post-date", no "<time>", nothing containing "date" inside any "article.et-item" block. The
-- real publish date only exists on each article's detail page (e.g. `<div class="union-time">在
-- 2026-07-20 发布</div>`), which fetchHtml (single list-page scrape, apps/worker/src/fetchers/
-- html.ts) cannot reach. Enabling this source as-is would make every item fall back to fetch time
-- (html.ts: `dateText ? new Date(dateText) : new Date()`), stamping historical articles with a
-- fake "today" and permanently corrupting timeline sort order (URL dedup means the wrong date can
-- never self-correct on a later fetch).
--
-- ponytail: kept disabled until the fetcher supports a per-item detail-page date fetch; the date
-- selector below documents the real class name (only reachable from the detail page) so a future
-- fetcher extension can use it directly instead of re-discovering it.
--
-- Deliberate narrow exception to the normal admin_snapshot/admin_touched_at migration guard:
-- this is a safety-disable migration preventing false publication timestamps, so the final UPDATE
-- must override an admin-set enabled=true. Admin-owned config remains protected because a custom
-- selector may be valid; only enabled, fail_count, and the explanatory last_error are forced.

BEGIN;

UPDATE sources
SET url = 'https://www.cnesa.org/index/news',
    config = '{
      "type": "html",
      "listUrl": "https://www.cnesa.org/index/news",
      "useRealUa": true,
      "selectors": {
        "item": "article.et-item",
        "title": ".post-title a",
        "link": ".post-title a",
        "date": ".union-time",
        "content": ".post-excerpt"
      }
    }'::jsonb,
    enabled = false
WHERE name = '中关村储能产业技术联盟 CNESA'
  AND url = 'http://www.cnesa.org/index/news'
  AND NOT COALESCE(admin_snapshot ? 'config', false);

UPDATE sources
SET enabled = false,
    fail_count = 0,
    -- last_error_at left untouched on purpose: it records the real last fetch failure. This
    -- migration is a review decision, so nulling that timestamp would destroy observability.
    last_error = '2026-07-27 复核：list page has no per-item date element; disabled pending detail-page date fetch support (see migration comment)'
WHERE url IN (
  'http://www.cnesa.org/index/news',
  'https://www.cnesa.org/index/news'
);

DO $$ BEGIN
  RAISE NOTICE '0040 CNESA safety-disable result: disabled_rows=%, admin_touched_rows=%',
    (SELECT count(*) FROM sources
      WHERE url IN (
        'http://www.cnesa.org/index/news',
        'https://www.cnesa.org/index/news'
      )
      AND enabled = false
      AND last_error = '2026-07-27 复核：list page has no per-item date element; disabled pending detail-page date fetch support (see migration comment)'),
    (SELECT count(*) FROM sources
      WHERE url IN (
        'http://www.cnesa.org/index/news',
        'https://www.cnesa.org/index/news'
      )
      AND admin_touched_at IS NOT NULL
      AND enabled = false
      AND last_error = '2026-07-27 复核：list page has no per-item date element; disabled pending detail-page date fetch support (see migration comment)');
END $$;

COMMIT;

-- Rollback (manual):
-- UPDATE sources
-- SET url='http://www.cnesa.org/index/news',
--     config='{"type":"html","listUrl":"http://www.cnesa.org/index/news","selectors":{"item":"article.et-item","title":"a","link":"a","date":"time"}}'::jsonb,
--     enabled=false
-- WHERE name='中关村储能产业技术联盟 CNESA'
--   AND url='https://www.cnesa.org/index/news';
