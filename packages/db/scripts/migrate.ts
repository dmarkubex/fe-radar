import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/** Split a multi-statement SQL string on top-level `;`, respecting quotes, comments, and dollar-quoting. */
export function splitStatements(sql: string): string[] {
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

export function toRunnableSql(sql: string): string {
  if (process.env.MIGRATION_PROFILE !== "e2e") {
    return sql;
  }

  return sql
    .replace(/^CREATE EXTENSION IF NOT EXISTS (vector|zhparser);\n/gm, "")
    .replace(/DO \$\$ BEGIN[\s\S]*?END\s*\$\$;\n/g, "")
    .replace(/embedding\s+vector\(1024\)/g, "embedding real[]")
    .replace(/centroid\s+vector\(1024\)/g, "centroid real[]")
    .replace(/CREATE INDEX (IF NOT EXISTS )?items_fts_idx[\s\S]*?\);\n/g, "")
    .replace(/CREATE INDEX (IF NOT EXISTS )?analysis_emb_idx[\s\S]*?\);\n/g, "");
}

/**
 * Migration files wrap their body in a top-level `BEGIN;`/`COMMIT;` pair so they can
 * still be run standalone via psql. The ledger now owns transaction control (one
 * transaction per file, ending with the ledger insert), so these two statements must
 * be filtered out before execution — sending a raw COMMIT inside `sql.begin()` would
 * end the transaction early and break the library's own closing COMMIT.
 * Leading/trailing `--` comment lines are stripped first because splitStatements()
 * folds any comment text preceding a statement into the same chunk.
 */
export function isBeginOrCommit(stmt: string): boolean {
  const withoutLineComments = stmt
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
  return /^(BEGIN|COMMIT)$/i.test(withoutLineComments);
}

export function checksum(content: string): string {
  // Keep stored checksums byte-exact. runMigrations repairs only LF/CRLF-equivalent
  // hashes, so genuine published migration changes still fail closed.
  return createHash("sha256").update(content).digest("hex");
}

function lineEndingChecksums(content: string): Set<string> {
  const lf = content.replace(/\r\n/g, "\n");
  return new Set([checksum(lf), checksum(lf.replace(/\n/g, "\r\n"))]);
}

// 0022 never executed in production (0001–0037 were baselined), but its old SQL cannot
// bootstrap a fresh database. Keep checksum enforcement strict to this reviewed repair pair.
// Chosen repair: after one approved skip, advance the ledger to the current checksum so the
// exception converges and can be retired safely after every deployed ledger has been upgraded.
const PUBLISHED_MIGRATION_REPAIRS = new Map([
  [
    "0022_bjx_html_fetcher.sql",
    {
      previous: new Set([
        // Historical d64e1c5 checkout on LF hosts.
        "5f43113c2ceac0acfa731dca73bc2b4dd5a14cba0fcb8e74b4088456ec9e56c7",
        // The same historical content on Windows core.autocrlf=true (production ledger).
        "a87b2857febeaaf1a773a8f38e4c27874d7742d93229eec66fb645213aa5d4d5"
      ]),
      current: new Set([
        // Reviewed repair content on LF hosts.
        "c476393a58aa422491355e96ba57df18bbe3af30288af8ed6ca94fcc718e6894",
        // The same reviewed repair content on Windows core.autocrlf=true.
        "a2af29fbed76f4df52fe3dd9f16706412887f3a3d98b4940ae9e98559c20c50b"
      ])
    }
  ]
]);

/**
 * Minimal port the migration runner needs from a database connection. Real
 * implementation talks to Postgres; tests use an in-memory fake so the ledger
 * control flow (skip / apply / checksum-mismatch / baseline) is verified without
 * a live database — this repo has no real-Postgres test harness (see lessons.md).
 */
export interface LedgerPort {
  lock(): Promise<void>;
  unlock(): Promise<void>;
  ensureTable(): Promise<void>;
  tableExists(name: string): Promise<boolean>;
  getApplied(): Promise<Map<string, string>>;
  insertBaselineRow(file: string, checksum: string): Promise<void>;
  repairChecksum(
    file: string,
    previousChecksum: string,
    currentChecksum: string
  ): Promise<void>;
  applyMigration(
    file: string,
    statements: string[],
    checksum: string
  ): Promise<void>;
}

export function createPostgresLedger(sql: postgres.Sql): LedgerPort {
  return {
    async lock() {
      await sql`SELECT pg_advisory_lock(hashtext('fe_radar_schema_migrations'))`;
    },
    async unlock() {
      await sql`SELECT pg_advisory_unlock(hashtext('fe_radar_schema_migrations'))`;
    },
    async ensureTable() {
      await sql`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename   text PRIMARY KEY,
          checksum   text NOT NULL,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `;
    },
    async tableExists(name) {
      const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables WHERE table_name = ${name}
        ) AS exists
      `;
      return rows[0]?.exists ?? false;
    },
    async getApplied() {
      const rows = await sql<{ filename: string; checksum: string }[]>`
        SELECT filename, checksum FROM schema_migrations
      `;
      return new Map(rows.map((row) => [row.filename, row.checksum]));
    },
    async insertBaselineRow(file, fileChecksum) {
      await sql`
        INSERT INTO schema_migrations (filename, checksum)
        VALUES (${file}, ${fileChecksum})
      `;
    },
    async repairChecksum(file, previousChecksum, currentChecksum) {
      const result = await sql`
        UPDATE schema_migrations
        SET checksum = ${currentChecksum}
        WHERE filename = ${file} AND checksum = ${previousChecksum}
      `;
      if (result.count !== 1) {
        throw new Error(`failed to repair checksum ledger entry for ${file}`);
      }
    },
    async applyMigration(file, statements, fileChecksum) {
      await sql.begin(async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
        await tx`
          INSERT INTO schema_migrations (filename, checksum)
          VALUES (${file}, ${fileChecksum})
        `;
      });
    }
  };
}

export interface RunMigrationsOptions {
  files: string[];
  readFile: (file: string) => string;
  ledger: LedgerPort;
  baseline?: string;
  log?: (line: string) => void;
}

/**
 * Baseline handles the one-time cutover for databases that already reflect some
 * migrations' effects but predate this ledger (e.g. hand-provisioned environments).
 * It records history without re-executing SQL; once the ledger has any row, baseline
 * is refused so it can't be used to silently skip a migration on a normal deploy.
 */
export async function runMigrations(
  options: RunMigrationsOptions
): Promise<string[]> {
  const { files, readFile, ledger, baseline, log = console.log } = options;
  const output: string[] = [];
  const emit = (line: string) => {
    output.push(line);
    log(line);
  };

  await ledger.ensureTable();
  const applied = await ledger.getApplied();
  const baselinedThisRun = new Set<string>();

  if (applied.size === 0) {
    const isExistingDatabase = await ledger.tableExists("sources");
    if (isExistingDatabase) {
      if (!baseline) {
        throw new Error(
          "existing database detected (sources table already present) with an empty schema_migrations ledger; " +
            "set MIGRATION_BASELINE=<last-applied-migration-filename> once to record history without re-running it"
        );
      }
      const baselineIndex = files.indexOf(baseline);
      if (baselineIndex === -1) {
        throw new Error(
          `MIGRATION_BASELINE=${baseline} does not match any migration file`
        );
      }
      for (const file of files.slice(0, baselineIndex + 1)) {
        const content = readFile(file);
        const fileChecksum = checksum(content);
        await ledger.insertBaselineRow(file, fileChecksum);
        applied.set(file, fileChecksum);
        baselinedThisRun.add(file);
        emit(`baselined ${file}`);
      }
    }
  } else if (baseline) {
    throw new Error(
      "MIGRATION_BASELINE is only allowed when schema_migrations is empty; ledger already has entries"
    );
  }

  for (const file of files) {
    if (baselinedThisRun.has(file)) {
      continue;
    }

    const content = readFile(file);
    const fileChecksum = checksum(content);
    const previousChecksum = applied.get(file);

    if (previousChecksum !== undefined) {
      const repair = PUBLISHED_MIGRATION_REPAIRS.get(file);
      const isLineEndingRepair =
        previousChecksum !== fileChecksum &&
        lineEndingChecksums(content).has(previousChecksum);
      const isReviewedContentRepair =
        repair?.previous.has(previousChecksum) === true &&
        repair.current.has(fileChecksum);
      const isApprovedRepair =
        isLineEndingRepair || isReviewedContentRepair;
      if (previousChecksum !== fileChecksum && !isApprovedRepair) {
        throw new Error(
          `checksum mismatch for already-applied migration ${file}: published migrations must not change ` +
            `(ledger has ${previousChecksum}, file now hashes to ${fileChecksum})`
        );
      }
      if (isApprovedRepair) {
        await ledger.repairChecksum(file, previousChecksum, fileChecksum);
        applied.set(file, fileChecksum);
      }
      emit(`${isApprovedRepair ? "repaired" : "skipped"} ${file}`);
      continue;
    }

    const statements = splitStatements(toRunnableSql(content)).filter(
      (stmt) => !isBeginOrCommit(stmt)
    );
    await ledger.applyMigration(file, statements, fileChecksum);
    applied.set(file, fileChecksum);
    emit(`applied ${file}`);
  }

  return output;
}

// ---------------------------------------------------------------------------
// T-CA-02 / v1.3 Copilot（design §7）：
// 1. runMigrations 之前（advisory lock 内、非事务）幂等创建 copilot_app ——
//    0064 的 GRANT 引用该角色，且 CREATE ROLE 不能写进 0064（sql.begin 事务内会
//    25001）。必须 LOGIN：CREATE ROLE 默认 NOLOGIN，角色连不上库。
// 2. runMigrations 成功之后、unlock 之前设密码（env / file，两处都缺则 warn
//    跳过、正常退出 —— 日常不带该 env 的 migrate 必须成功）。
// 密码或其 SQL 严禁写进日志。
// ---------------------------------------------------------------------------
const COPILOT_APP_ROLE = "copilot_app";

async function ensureCopilotAppRole(sql: postgres.Sql): Promise<void> {
  const existing = await sql`
    SELECT 1 FROM pg_roles WHERE rolname = ${COPILOT_APP_ROLE}
  `;
  if (existing.length > 0) {
    console.log(`role ${COPILOT_APP_ROLE} already exists`);
    return;
  }
  await sql.unsafe(
    `CREATE ROLE ${COPILOT_APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`
  );
  console.log(`created role ${COPILOT_APP_ROLE}`);
}

function readCopilotAppPassword(): string {
  const fromEnv = process.env.COPILOT_APP_PASSWORD;
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  const file = process.env.COPILOT_APP_PASSWORD_FILE;
  if (file === undefined) {
    return "";
  }
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    console.warn(`failed to read COPILOT_APP_PASSWORD_FILE=${file}`);
    return "";
  }
}

async function applyCopilotAppPassword(sql: postgres.Sql): Promise<void> {
  const password = readCopilotAppPassword();
  if (password === "") {
    console.warn(
      "COPILOT_APP_PASSWORD / COPILOT_APP_PASSWORD_FILE not provided; skipping copilot_app password"
    );
    return;
  }
  const existing = await sql`
    SELECT 1 FROM pg_roles WHERE rolname = ${COPILOT_APP_ROLE}
  `;
  if (existing.length === 0) {
    console.warn(`role ${COPILOT_APP_ROLE} missing; skipping password`);
    return;
  }
  const escaped = password.replace(/'/g, "''");
  await sql.unsafe(`ALTER ROLE ${COPILOT_APP_ROLE} PASSWORD '${escaped}'`);
  console.log(`updated password for role ${COPILOT_APP_ROLE}`);
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

  const ledger = createPostgresLedger(sql);

  try {
    await ledger.lock();
    try {
      // T-CA-02: 角色先于 runMigrations（0064 GRANT 引用它），非事务、幂等
      await ensureCopilotAppRole(sql);
      await runMigrations({
        files,
        readFile: (file) => readFileSync(join(migrationsDir, file), "utf8"),
        ledger,
        baseline: process.env.MIGRATION_BASELINE
      });
      // T-CA-02: 密码步在 runMigrations 成功之后、unlock 之前
      await applyCopilotAppPassword(sql);
    } finally {
      await ledger.unlock();
    }
  } finally {
    await sql.end();
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
