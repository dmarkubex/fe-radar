-- 0059_disable_legacy_viewer_credential.sql
-- T-SEC-02 (复核 F1): 新安装不再创建 viewer/viewer-password，但升级时既有该行仍存活。
-- 此迁移禁用仓库已知凭据创建的 viewer 账号（仅匹配 username='viewer' 且角色 viewer 的行），
-- 不删除（保留审计），由 admin 决定轮换或彻底删除。
--
-- 仅作用于已知默认账号；admin 手工建的其它 viewer 账号不受影响。
-- 幂等：disabled_at 已设的行 UPDATE 仍写同值，无副作用。
--
-- ROLLBACK (manual only — do not auto-run):
--   UPDATE users SET disabled_at = NULL WHERE username = 'viewer' AND role = 'viewer';
--   （仅在确认该账号已轮换密码后才回滚。）

BEGIN;

UPDATE users
SET disabled_at = COALESCE(disabled_at, NOW()),
    token_version = token_version + 1
WHERE username = 'viewer'
  AND role = 'viewer'
  AND dingtalk_id IS NULL;

COMMIT;
