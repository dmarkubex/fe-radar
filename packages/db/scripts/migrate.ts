import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

function toRunnableSql(sql: string): string {
  if (process.env.MIGRATION_PROFILE !== "e2e") {
    return sql;
  }

  return sql
    .replace(/^CREATE EXTENSION IF NOT EXISTS (vector|zhparser);\n/gm, "")
    .replace(/^DROP TEXT SEARCH CONFIGURATION IF EXISTS zhparser;\n/gm, "")
    .replace(/^CREATE TEXT SEARCH CONFIGURATION zhparser \(PARSER = zhparser\);\n/gm, "")
    .replace(/^ALTER TEXT SEARCH CONFIGURATION zhparser ADD MAPPING FOR n,v,a,i,e,l WITH simple;\n/gm, "")
    .replace(/embedding\s+vector\(1024\)/g, "embedding real[]")
    .replace(/centroid\s+vector\(1024\)/g, "centroid real[]")
    .replace(/CREATE INDEX items_fts_idx[\s\S]*?\);\n/g, "")
    .replace(/CREATE INDEX analysis_emb_idx[\s\S]*?\);\n/g, "");
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const migrationsDir = new URL("../migrations", import.meta.url).pathname;
  // Forward migrations only. `*.down.sql` are reverse migrations applied
  // manually for explicit rollback — they must never run in the forward loop
  // (doing so would drop tables on every migrate).
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql") && !file.endsWith(".down.sql"))
    .sort();

  try {
    for (const file of files) {
      const migration = toRunnableSql(readFileSync(join(migrationsDir, file), "utf8"));
      // Split multi-statement SQL — postgres extended protocol only supports one
      // statement per query; simple:true is unreliable across library versions.
      const statements = migration
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (const stmt of statements) {
        await sql.unsafe(stmt);
      }
      console.log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
