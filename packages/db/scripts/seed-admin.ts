import bcrypt from "bcryptjs";
import postgres from "postgres";

const BCRYPT_WORK_FACTOR = 12;

export interface SeedUser {
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
 * T-SEC-02 / T15e: admin 走 upsert（首次部署必须能建，且能修名/部门/角色），
 * 但**不再清空 disabled_at** —— 部署不能自动解禁 admin 之前禁用的账号。
 *
 * 密码轮换经 env 驱动是预期行为，但 **token_version 仅在明文密码相对存量
 * hash 真正变化时才 +1**（应用层 bcrypt.compare；禁止 SQL 字面量比较 hash——
 * bcrypt 每次 hash 带随机 salt，字面量恒假）。日常 Portainer 把 migrate 与
 * seed:admin 绑在一起重跑时，若 SEED_ADMIN_PASSWORD 未变，不得踢掉已登录
 * admin 会话。密码确实轮换时仍 +1，保留 T-SEC-06「旧 JWT 立即失效」。
 *
 * name / dept / role 仍无条件更新（非凭据，改了就该生效）。
 * SELECT+UPDATE 之间的竞态窗口可接受（一次性部署脚本，不加锁）。
 */
export async function upsertAdmin(sql: postgres.Sql, user: SeedUser): Promise<void> {
  const existing = await sql<{ password_hash: string | null }[]>`
    SELECT password_hash FROM users WHERE username = ${user.username}
  `;
  const existingHash = existing[0]?.password_hash;

  let isChanged = true;
  if (typeof existingHash === "string" && existingHash.length > 0) {
    // compare 返回 true = 明文与存量 hash 匹配 = 密码未变
    isChanged = !(await bcrypt.compare(user.password, existingHash));
  }

  const passwordHash = await bcrypt.hash(user.password, BCRYPT_WORK_FACTOR);
  // 动态 SQL 片段：仅密码真变时递增 token_version；否则保持原值
  const tokenVersionExpr = isChanged
    ? sql`users.token_version + 1`
    : sql`users.token_version`;

  await sql`
    INSERT INTO users (username, password_hash, name, dept, role)
    VALUES (${user.username}, ${passwordHash}, ${user.name}, ${user.dept}, ${user.role})
    ON CONFLICT (username) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      name          = EXCLUDED.name,
      dept          = EXCLUDED.dept,
      role          = EXCLUDED.role,
      token_version = ${tokenVersionExpr}
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

// 仅直接执行时运行 main()，被测试 import 时不触发 DB 连接。
if (process.argv[1]?.includes("seed-admin")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
