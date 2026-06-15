import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Split a multi-statement SQL string on top-level `;`, respecting quotes, comments, and dollar-quoting. */
function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let inStr = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inDollar = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      cur += ch;
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      cur += ch;
      if (ch === "*" && next === "/") {
        cur += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }
    if (inDollar) {
      cur += ch;
      if (ch === "$" && next === "$") {
        cur += next;
        i++;
        inDollar = false;
      }
      continue;
    }
    if (inStr) {
      cur += ch;
      if (ch === "'" && next === "'") {
        cur += next;
        i++;
      } else if (ch === "'") {
        inStr = false;
      }
      continue;
    }

    if (ch === "'") {
      inStr = true;
    } else if (ch === "$" && next === "$") {
      inDollar = true;
      cur += ch;
      i++;
      cur += next;
      continue;
    } else if (ch === "-" && next === "-") {
      inLineComment = true;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
    } else if (ch === ";") {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = "";
      continue;
    }
    cur += ch;
  }

  const trimmed = cur.trim();
  if (trimmed) stmts.push(trimmed);
  return stmts;
}

function toRunnableSql(sql: string): string {
  if (process.env.MIGRATION_PROFILE !== "e2e") {
    return sql;
  }

  return sql
    .replace(/^CREATE EXTENSION IF NOT EXISTS (vector|zhparser);\n/gm, "")
    .replace(/DO \$\$ BEGIN[\s\S]*?END\s*\$\$;\n/g, "")
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
      const statements = splitStatements(migration);
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
