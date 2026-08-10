-- 0061_legacy_viewer_credential_purge.sql
-- S4 / T-SEC High: 0059 仅匹配 `dingtalk_id IS NULL`，已绑钉钉的遗留 viewer 行
-- 仍保留仓库公开默认口令对应的 password_hash。账号绑定钉钉时（mergeOrCreateUser）
-- 不会清除 password_hash。一旦运维打开 EMERGENCY_LOCAL_LOGIN=true，已知默认口令仍可本地登录。
--
-- 本迁移覆盖所有 username='viewer' AND role='viewer' 的遗留本地凭据，不再按 dingtalk_id 漏掉：
--   A) 已绑钉钉：password_hash → NULL + token_version+1；**不**禁用（正常钉钉账号）
--   B) 未绑钉钉且仍启用：disabled_at 置 NOW + token_version+1（维持 0059 语义）
--
-- 幂等：
--   A 仅当 password_hash IS NOT NULL；B 仅当 disabled_at IS NULL。
--   0059 已禁用的纯本地行、本迁移已清 hash 的钉钉行，重跑零行变更。
--
-- 约束：users_credentials_check 允许 (dingtalk_id IS NOT NULL) 时 password_hash 为 NULL；
--   纯本地账号不能把 password_hash 置 NULL，故 B 只禁用不删 hash（disabled 在 authorize 侧拒绝）。
--
-- ROLLBACK (manual only — do not auto-run):
--   -- A 不可自动恢复原 hash；若需本地登录须由 admin 另行设新密码。
--   -- B: UPDATE users SET disabled_at = NULL
--   --      WHERE username = 'viewer' AND role = 'viewer' AND dingtalk_id IS NULL;
--   （仅在确认口令已轮换后才回滚禁用。）

BEGIN;

-- A: 已绑钉钉的 viewer 仍持有本地 password → 清凭据 + 撤权，保留账号可用
UPDATE users
SET password_hash = NULL,
    token_version = token_version + 1
WHERE username = 'viewer'
  AND role = 'viewer'
  AND dingtalk_id IS NOT NULL
  AND password_hash IS NOT NULL;

-- B: 未绑钉钉且仍启用的遗留 viewer → 禁用 + 撤权（0059 漏跑 / 新装顺序）
UPDATE users
SET disabled_at = COALESCE(disabled_at, NOW()),
    token_version = token_version + 1
WHERE username = 'viewer'
  AND role = 'viewer'
  AND dingtalk_id IS NULL
  AND disabled_at IS NULL;

COMMIT;
