import bcrypt from "bcryptjs";
import postgres from "postgres";

const BCRYPT_WORK_FACTOR = 12;

interface SeedUser {
  username: string;
  password: string;
  name: string;
  dept: string;
  role: "admin" | "viewer";
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

/**
 * T-SEC-02: admin 走 upsert（首次部署必须能建，且能修名/部门/角色），
 * 但**不再清空 disabled_at** —— 部署不能自动解禁 admin 之前禁用的账号。
 * 密码在冲突时仍重置（admin 密码轮换经 env 驱动是预期行为）；
 * 轮换同时递增 token_version，让被盗的旧 admin JWT 立即失效（T-SEC-06 复核）。
 * OPS 注意：**每次重跑 seed 都视为一次轮换**（即使密码没变），会踢掉该 admin 的全部
 * 现有会话——不要把 seed:admin 当无害的幂等脚本随手重跑。
 */
async function upsertAdmin(sql: postgres.Sql, user: SeedUser): Promise<void> {
  const passwordHash = await bcrypt.hash(user.password, BCRYPT_WORK_FACTOR);
  await sql`
    INSERT INTO users (username, password_hash, name, dept, role)
    VALUES (${user.username}, ${passwordHash}, ${user.name}, ${user.dept}, ${user.role})
    ON CONFLICT (username) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      name          = EXCLUDED.name,
      dept          = EXCLUDED.dept,
      role          = EXCLUDED.role,
      token_version = users.token_version + 1
  `;
  console.log(`seeded ${user.role} ${user.username}`);
}

/**
 * T-SEC-02: viewer 改为 insert-only —— **仅当显式提供用户名和密码时才首次创建**，
 * 冲突时不改密码、不降角色、不解禁，避免部署反复重置/复活仓库已知凭据。
 * 缺少 SEED_VIEWER_* 时直接跳过（不再有 viewer/viewer-password 默认值）。
 */
async function createViewerIfProvided(sql: postgres.Sql, user: SeedUser): Promise<void> {
  const passwordHash = await bcrypt.hash(user.password, BCRYPT_WORK_FACTOR);
  await sql`
    INSERT INTO users (username, password_hash, name, dept, role)
    VALUES (${user.username}, ${passwordHash}, ${user.name}, ${user.dept}, ${user.role})
    ON CONFLICT (username) DO NOTHING
  `;
  console.log(`seeded ${user.role} ${user.username}`);
}

async function main(): Promise<void> {
  const databaseUrl = env("DATABASE_URL");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    await upsertAdmin(sql, {
      username: env("SEED_ADMIN_USERNAME"),
      password: env("SEED_ADMIN_PASSWORD"),
      name: process.env.SEED_ADMIN_NAME ?? "系统管理员",
      dept: process.env.SEED_ADMIN_DEPT ?? "产业情报",
      role: "admin"
    });

    // T-SEC-02: viewer 必须显式提供用户名 + 密码；不再有仓库默认凭据。
    const viewerUsername = process.env.SEED_VIEWER_USERNAME;
    const viewerPassword = process.env.SEED_VIEWER_PASSWORD;
    if (viewerUsername && viewerPassword) {
      await createViewerIfProvided(sql, {
        username: viewerUsername,
        password: viewerPassword,
        name: process.env.SEED_VIEWER_NAME ?? "只读用户",
        dept: process.env.SEED_VIEWER_DEPT ?? "产业情报",
        role: "viewer"
      });
    } else {
      console.log("skip viewer seed (SEED_VIEWER_USERNAME / SEED_VIEWER_PASSWORD not set)");
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
