-- 0061_legacy_viewer_credential_purge.sql
-- S4 / T-SEC High: 0059 仅匹配 `dingtalk_id IS NULL`，已绑钉钉的遗留 viewer 行
-- 仍保留仓库公开默认口令对应的 password_hash。账号绑定钉钉时（mergeOrCreateUser）
-- 不会清除 password_hash。一旦运维打开 EMERGENCY_LOCAL_LOGIN=true，已知默认口令仍可本地登录。
--
-- A-3 / T3：按 username='viewer' + 钉钉绑定状态 + 凭据状态分流，**不再按 role 过滤**。
-- 失败场景：默认账号被提权为 editor/admin 后 role 已变，旧 `role='viewer'` 条件漏匹配，
-- 高权限账号仍持有仓库公开默认口令。
--
-- 分支说明：
--   A) 已绑钉钉且仍有 password_hash：password_hash → NULL + token_version+1；**不**禁用
--   B) ~~未绑钉钉且仍启用：disabled_at 置 NOW + token_version+1~~ → **已移除（B-3 fix）**
--
-- B-3 fix：分支 B 从迁移中移除。原因：SQL 无法安全比对 bcrypt hash（每次生成带随机盐），
--   无法区分"仍是原始泄漏口令"与"admin 合法轮换后的强口令"——SQL 只看状态不看内容，
--   会把"曾被禁用、后被 admin 合法重新启用、用户名恰为 viewer 且未绑钉钉"的纯本地账号
--   错误地重新禁用（无钉钉 fallback = 完全锁死）。
--   分支 B 改为应用层脚本 packages/db/scripts/purge-legacy-viewer-branch-b.ts，
--   用 bcrypt.compare 验证口令内容后再决定是否禁用。需在应用本迁移后由运维手动执行一次，
--   不属于自动 migration 流程的一部分。
--
-- 幂等：
--   A 仅当 password_hash IS NOT NULL。0059 已禁用的纯本地行、本迁移已清 hash 的钉钉行，重跑零行变更。
--
-- 约束：users_credentials_check 允许 (dingtalk_id IS NOT NULL) 时 password_hash 为 NULL；
--   纯本地账号不能把 password_hash 置 NULL（但分支 B 已移除，不再在此迁移处理纯本地行）。
--
-- ROLLBACK (manual only — do not auto-run):
--   -- A 不可自动恢复原 hash；若需本地登录须由 admin 另行设新密码。
--   -- （分支 B 的回滚见 purge-legacy-viewer-branch-b.ts 脚本说明，不属于本迁移。）

BEGIN;

-- A: 已绑钉钉的 username=viewer（含已提权 admin/editor）仍持有本地 password → 清凭据 + 撤权，保留账号可用
UPDATE users
SET password_hash = NULL,
    token_version = token_version + 1
WHERE username = 'viewer'
  AND dingtalk_id IS NOT NULL
  AND password_hash IS NOT NULL;

-- B-3 fix: 分支 B 已移除——SQL 无法区分泄漏口令与合法轮换口令（bcrypt 随机盐）。
-- 改为应用层脚本 packages/db/scripts/purge-legacy-viewer-branch-b.ts（bcrypt.compare 验证后禁用）。
-- 运维须在应用本迁移后手动执行该脚本一次，review 输出中被跳过的行（如有），逐个人工确认。

COMMIT;
