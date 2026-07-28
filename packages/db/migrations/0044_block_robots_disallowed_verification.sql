-- 0044_block_robots_disallowed_verification.sql
-- Compliance denylist for sources whose target paths are explicitly disallowed by robots.txt.
-- Store the verification policy in DB config so diagnostic tooling does not hardcode source URLs.
--
-- Matching is keyed on `url`, not `name`: `name` is admin-editable from the backend, so a rename
-- before this migration runs would silently match zero rows and leave a robots-disallowed source
-- verifiable. `url` is the natural key here (unique constraint, and no migration in the chain ever
-- rewrites these four URLs -- verified against 0004/0014/0015/0017).
--
-- The guard below fails the deploy loudly if the denylist stops resolving to exactly four rows,
-- because a silently-empty compliance update is the failure mode this migration exists to prevent.

BEGIN;

DO $$ BEGIN
  IF (
    SELECT count(*) FROM sources WHERE url IN (
      'https://www.solarbe.com/news/',
      'https://weixin.sogou.com/weixin?type=1&query=%E7%94%B5%E7%BC%86%E5%A4%B4%E6%9D%A1',
      'https://weixin.sogou.com/weixin?type=1&query=%E5%82%A8%E8%83%BD%E5%A4%B4%E6%9D%A1',
      'https://xueqiu.com/k?q=%E7%94%B5%E7%BC%86'
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'robots denylist expected 4 source rows but the seeded URLs no longer resolve; re-check them before deploying -- a robots-disallowed source must not stay verifiable';
  END IF;
END $$;

UPDATE sources
SET enabled = false,
    config = config || '{"verificationBlocked":true,"verificationBlockedReason":"robots.txt explicitly disallows target path"}'::jsonb
WHERE url IN (
  'https://www.solarbe.com/news/',
  'https://weixin.sogou.com/weixin?type=1&query=%E7%94%B5%E7%BC%86%E5%A4%B4%E6%9D%A1',
  'https://weixin.sogou.com/weixin?type=1&query=%E5%82%A8%E8%83%BD%E5%A4%B4%E6%9D%A1',
  'https://xueqiu.com/k?q=%E7%94%B5%E7%BC%86'
);

COMMIT;

-- Rollback is intentionally manual. Remove verificationBlocked only after robots.txt permits
-- the configured target path and compliance has approved reactivation.
