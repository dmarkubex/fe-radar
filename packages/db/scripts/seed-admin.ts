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

async function upsertUser(sql: postgres.Sql, user: SeedUser): Promise<void> {
  const passwordHash = await bcrypt.hash(user.password, BCRYPT_WORK_FACTOR);
  await sql`
    INSERT INTO users (username, password_hash, name, dept, role)
    VALUES (${user.username}, ${passwordHash}, ${user.name}, ${user.dept}, ${user.role})
    ON CONFLICT (username) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      name = EXCLUDED.name,
      dept = EXCLUDED.dept,
      role = EXCLUDED.role,
      disabled_at = NULL
  `;
  console.log(`seeded ${user.role} ${user.username}`);
}

async function main(): Promise<void> {
  const databaseUrl = env("DATABASE_URL");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    await upsertUser(sql, {
      username: env("SEED_ADMIN_USERNAME"),
      password: env("SEED_ADMIN_PASSWORD"),
      name: process.env.SEED_ADMIN_NAME ?? "系统管理员",
      dept: process.env.SEED_ADMIN_DEPT ?? "产业情报",
      role: "admin"
    });

    await upsertUser(sql, {
      username: process.env.SEED_VIEWER_USERNAME ?? "viewer",
      password: process.env.SEED_VIEWER_PASSWORD ?? "viewer-password",
      name: process.env.SEED_VIEWER_NAME ?? "只读用户",
      dept: process.env.SEED_VIEWER_DEPT ?? "产业情报",
      role: "viewer"
    });
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
