/**
 * purge-legacy-viewer-branch-b.ts
 *
 * B-3 fix: 0061 迁移分支 B（禁用未绑钉钉的 username=viewer 账号）从自动迁移
 * 中移除，改为本应用层脚本。原因：SQL 无法安全比对 bcrypt hash（每次生成带
 * 随机盐），无法区分"仍是原始泄漏口令"与"admin 合法轮换后的强口令"——SQL 层
 * 的判定只看状态（password_hash 是否存在、disabled_at 是否为空），不看内容，
 * 会把"曾被禁用、后被 admin 合法重新启用、用户名恰为 viewer 且未绑钉钉"的纯
 * 本地账号错误地重新禁用，无绕过路径（该账号没绑钉钉退不到 SSO）= 完全锁死。
 *
 * 本脚本用 bcrypt.compare 验证候选行的 password_hash 是否确实等于已知泄漏口令
 * 明文，只禁用匹配行；不匹配（已轮换）的行跳过并打印提示，等运维人工确认。
 *
 * 已知泄漏口令明文 = "viewer-password"（三处独立确认，一致）：
 *   - 0059_disable_legacy_viewer_credential.sql:2
 *   - seed-admin.ts:48
 *   - migration-0059-legacy-viewer.test.ts:10
 *
 * 运维步骤：应用 0061 迁移后手动执行本脚本一次。
 *   DATABASE_URL=... pnpm --filter @fe-radar/db tsx scripts/purge-legacy-viewer-branch-b.ts
 *
 * 输出：对每个候选行打印 disabled / SKIP；结尾汇总。
 * 若有 SKIP 行，运维需逐个人工确认该账号是否需要保留。
 */
import bcrypt from "bcryptjs";
import postgres from "postgres";

/**
 * 已知泄漏的遗留 viewer 默认口令明文。
 * 直接使用此字符串，不要再去别处确认或改用其它值（三处独立确认一致）。
 */
export const LEAKED_VIEWER_PASSWORD = "viewer-password";

/** 从 DB 查出的候选行（分支 B 范围）。 */
export interface CandidateRow {
  id: number;
  username: string;
  passwordHash: string | null;
}

/** 单个候选行的处置决定。 */
export interface PurgeDecision {
  row: CandidateRow;
  shouldDisable: boolean;
}

/**
 * 纯决策函数：用 bcrypt.compare 判断候选行的 hash 是否确实是已知泄漏口令。
 * 从 DB I/O 中抽出，便于单测注入 mock compare。
 *
 * - passwordHash 为 null → 跳过（0061 分支 A 已清理绑钉钉行；
 *   纯本地 null-hash 行本就无法登录，不在本脚本范围）
 * - compare 返回 true → hash 确实是泄漏口令 → 禁用
 * - compare 返回 false → 口令已被合法轮换 → 跳过，需人工确认
 */
export async function decidePurge(
  row: CandidateRow,
  compare: (plain: string, hash: string) => Promise<boolean>,
): Promise<PurgeDecision> {
  if (!row.passwordHash) {
    return { row, shouldDisable: false };
  }
  const isLeaked = await compare(LEAKED_VIEWER_PASSWORD, row.passwordHash);
  return { row, shouldDisable: isLeaked };
}

export interface PurgeResult {
  disabled: number;
  skipped: number;
}

/**
 * 主逻辑：遍历候选行，逐条用 decidePurge 决定禁用或跳过。
 * 导出供测试注入 mock compare + fake onDisable + log 捕获。
 *
 * 禁用行：调用 onDisable（生产中执行 UPDATE disabled_at + bump token_version）。
 * 跳过行：打印明确提示（账号 id/username，不打印密码或 hash）。
 *
 * V-3: onDisable 返回 { affected } 表示 UPDATE 实际受影响行数。
 * affected=0 表示 bcrypt 比对窗口内状态已变化（密码轮换/钉钉绑定/已被禁用），
 * 此时不应计为 disabled——打印明确日志，计为 skipped。
 */
export async function purgeBranchB(
  candidates: CandidateRow[],
  compare: (plain: string, hash: string) => Promise<boolean>,
  onDisable: (row: CandidateRow) => Promise<{ affected: number }>,
  log: (line: string) => void,
): Promise<PurgeResult> {
  let disabled = 0;
  let skipped = 0;

  for (const row of candidates) {
    const decision = await decidePurge(row, compare);
    if (decision.shouldDisable) {
      const { affected } = await onDisable(row);
      if (affected === 0) {
        // V-3: TOCTOU — state changed between SELECT and UPDATE
        skipped++;
        log(
          `SKIP user id=${row.id} username=${row.username} — state changed during purge window (password rotated or account bound/assigned); not disabled this run. Needs manual review.`,
        );
      } else {
        disabled++;
        log(
          `disabled user id=${row.id} username=${row.username} (matched leaked default credential)`,
        );
      }
    } else {
      skipped++;
      log(
        `SKIP user id=${row.id} username=${row.username} — password does not match leaked default; likely already rotated. Needs manual confirmation.`,
      );
    }
  }

  return { disabled, skipped };
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/** 分支 B 候选行查询：username=viewer, 未绑钉钉, 未禁用。
 *  V-1: password_hash AS "passwordHash" 别名必不可少——postgres v3 默认不做
 *  snake_case→camelCase 转换（client.ts 无 transform 配置），不加别名时
 *  运行时字段是 password_hash，decidePurge 读 row.passwordHash 永远 undefined。 */
export async function fetchCandidates(sql: postgres.Sql): Promise<CandidateRow[]> {
  return sql<CandidateRow[]>`
    SELECT id, username, password_hash AS "passwordHash"
    FROM users
    WHERE username = 'viewer'
      AND dingtalk_id IS NULL
      AND disabled_at IS NULL
  `;
}

/** 禁用单行 + bump token_version（使旧 JWT 立即失效）。
 *  V-3: TOCTOU guard — UPDATE 复验 SELECT 时刻的状态（password_hash / dingtalk_id /
 *  disabled_at），避免 bcrypt 比对窗口内状态变化后仍按陈旧快照执行禁用。
 *  返回受影响行数：0 表示窗口期间状态已变化，调用方应计为 skipped。 */
export async function disableCandidate(
  sql: postgres.Sql,
  row: CandidateRow,
): Promise<{ affected: number }> {
  const result = await sql`
    UPDATE users
    SET disabled_at = COALESCE(disabled_at, NOW()),
        token_version = token_version + 1
    WHERE id = ${row.id}
      AND username = 'viewer'
      AND dingtalk_id IS NULL
      AND disabled_at IS NULL
      AND password_hash = ${row.passwordHash}
  `;
  // postgres v3: result.count = affected row count (from CommandComplete)
  return { affected: result.count };
}

async function main(): Promise<void> {
  const databaseUrl = env("DATABASE_URL");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    const candidates = await fetchCandidates(sql);
    console.log(`found ${candidates.length} candidate(s) for branch B purge`);

    const result = await purgeBranchB(
      candidates,
      (plain, hash) => bcrypt.compare(plain, hash),
      (row) => disableCandidate(sql, row),
      (line) => console.log(line),
    );

    console.log(
      `done: ${result.disabled} disabled, ${result.skipped} skipped (review SKIP lines above)`,
    );
  } finally {
    await sql.end();
  }
}

// 仅直接执行时运行 main()，被测试 import 时不触发 DB 连接。
if (process.argv[1]?.includes("purge-legacy-viewer-branch-b")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
