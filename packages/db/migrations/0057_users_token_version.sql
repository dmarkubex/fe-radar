-- 0057_users_token_version.sql
-- T-SEC-06: 无状态 JWT 没有服务端撤权通道。加 token_version 列，禁用/降权/改密码/合并
-- 时递增，特权请求校验 token 内 token_version 与 DB 当前值一致，不符即 401。
-- 默认 0，所有现存 token 不需要重新登录（登录时写当前 DB 的 token_version）。
--
-- ROLLBACK (manual only — do not auto-run):
--   ALTER TABLE users DROP COLUMN token_version;

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

COMMIT;
