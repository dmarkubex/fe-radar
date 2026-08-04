import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checksum,
  isBeginOrCommit,
  runMigrations,
  splitStatements,
  type LedgerPort
} from "../migrate";

class FakeLedger implements LedgerPort {
  public applied: Map<string, string>;
  public sourcesExists: boolean;
  public appliedCalls: Array<{ file: string; statements: string[] }> = [];
  public locked = false;

  public constructor(
    options: { sourcesExists?: boolean; seed?: Map<string, string> } = {}
  ) {
    this.sourcesExists = options.sourcesExists ?? false;
    this.applied = new Map(options.seed ?? []);
  }

  public async lock(): Promise<void> {
    this.locked = true;
  }

  public async unlock(): Promise<void> {
    this.locked = false;
  }

  public async ensureTable(): Promise<void> {}

  public async tableExists(name: string): Promise<boolean> {
    return name === "sources" && this.sourcesExists;
  }

  public async getApplied(): Promise<Map<string, string>> {
    return new Map(this.applied);
  }

  public async insertBaselineRow(
    file: string,
    fileChecksum: string
  ): Promise<void> {
    this.applied.set(file, fileChecksum);
  }

  public async repairChecksum(
    file: string,
    previousChecksum: string,
    currentChecksum: string
  ): Promise<void> {
    if (this.applied.get(file) !== previousChecksum) {
      throw new Error(`failed to repair checksum ledger entry for ${file}`);
    }
    this.applied.set(file, currentChecksum);
  }

  public async applyMigration(
    file: string,
    statements: string[],
    fileChecksum: string
  ): Promise<void> {
    this.appliedCalls.push({ file, statements });
    this.applied.set(file, fileChecksum);
  }
}

const FILES = ["0001_init.sql", "0002_add_column.sql"];
const CONTENT: Record<string, string> = {
  "0001_init.sql":
    "-- 0001_init.sql\nBEGIN;\nCREATE TABLE foo (id int);\nCOMMIT;\n",
  "0002_add_column.sql":
    "-- 0002_add_column.sql\nBEGIN;\nALTER TABLE foo ADD COLUMN bar int;\nCOMMIT;\n"
};
const contentOf = (file: string): string => {
  const content = CONTENT[file];
  if (content === undefined) throw new Error(`unknown fixture file: ${file}`);
  return content;
};
const readFile = contentOf;
const BJX_MIGRATION_FILE = "0022_bjx_html_fetcher.sql";
const BJX_MIGRATION = readFileSync(
  new URL(`../../migrations/${BJX_MIGRATION_FILE}`, import.meta.url),
  "utf8"
);
const BJX_MIGRATION_CRLF = BJX_MIGRATION.replace(/\r?\n/g, "\r\n");
const LEGACY_BJX_CHECKSUM_LF =
  "5f43113c2ceac0acfa731dca73bc2b4dd5a14cba0fcb8e74b4088456ec9e56c7";
const LEGACY_BJX_CHECKSUM_CRLF =
  "a87b2857febeaaf1a773a8f38e4c27874d7742d93229eec66fb645213aa5d4d5";

describe("migrate ledger", () => {
  it("applies every file on a fresh database and records checksums", async () => {
    const ledger = new FakeLedger({ sourcesExists: false });

    const output = await runMigrations({
      files: FILES,
      readFile,
      ledger,
      log: () => {}
    });

    expect(output).toEqual([
      "applied 0001_init.sql",
      "applied 0002_add_column.sql"
    ]);
    expect(ledger.applied.get("0001_init.sql")).toBe(
      checksum(contentOf("0001_init.sql"))
    );
    expect(ledger.applied.get("0002_add_column.sql")).toBe(
      checksum(contentOf("0002_add_column.sql"))
    );
    // BEGIN/COMMIT must never reach the executed statement list — the ledger owns the transaction.
    for (const call of ledger.appliedCalls) {
      expect(call.statements.some((stmt) => isBeginOrCommit(stmt))).toBe(false);
    }
  });

  it("second run skips everything and makes no further calls", async () => {
    const ledger = new FakeLedger({ sourcesExists: false });
    await runMigrations({ files: FILES, readFile, ledger, log: () => {} });
    const callCountAfterFirstRun = ledger.appliedCalls.length;

    const secondOutput = await runMigrations({
      files: FILES,
      readFile,
      ledger,
      log: () => {}
    });

    expect(secondOutput).toEqual([
      "skipped 0001_init.sql",
      "skipped 0002_add_column.sql"
    ]);
    expect(ledger.appliedCalls.length).toBe(callCountAfterFirstRun);
  });

  it("refuses to run against an existing database with no baseline", async () => {
    const ledger = new FakeLedger({ sourcesExists: true });

    await expect(
      runMigrations({ files: FILES, readFile, ledger, log: () => {} })
    ).rejects.toThrow(/MIGRATION_BASELINE/);
  });

  it("baselines files up to the given filename without executing them, then applies the rest", async () => {
    const ledger = new FakeLedger({ sourcesExists: true });

    const output = await runMigrations({
      files: FILES,
      readFile,
      ledger,
      baseline: "0001_init.sql",
      log: () => {}
    });

    expect(output).toEqual([
      "baselined 0001_init.sql",
      "applied 0002_add_column.sql"
    ]);
    expect(ledger.appliedCalls.map((call) => call.file)).toEqual([
      "0002_add_column.sql"
    ]);
    expect(ledger.applied.get("0001_init.sql")).toBe(
      checksum(contentOf("0001_init.sql"))
    );
  });

  it("rejects an unknown baseline filename", async () => {
    const ledger = new FakeLedger({ sourcesExists: true });

    await expect(
      runMigrations({
        files: FILES,
        readFile,
        ledger,
        baseline: "9999_missing.sql",
        log: () => {}
      })
    ).rejects.toThrow(/does not match any migration file/);
  });

  it("refuses baseline once the ledger already has entries", async () => {
    const seed = new Map([
      ["0001_init.sql", checksum(contentOf("0001_init.sql"))]
    ]);
    const ledger = new FakeLedger({ sourcesExists: true, seed });

    await expect(
      runMigrations({
        files: FILES,
        readFile,
        ledger,
        baseline: "0001_init.sql",
        log: () => {}
      })
    ).rejects.toThrow(/only allowed when schema_migrations is empty/);
  });

  it("throws if an already-applied migration's content changed", async () => {
    const seed = new Map([["0001_init.sql", "deadbeef"]]);
    const ledger = new FakeLedger({ sourcesExists: false, seed });

    await expect(
      runMigrations({ files: FILES, readFile, ledger, log: () => {} })
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("repairs an LF/CRLF-only checksum mismatch without executing SQL", async () => {
    const lf = contentOf("0001_init.sql");
    const crlf = lf.replace(/\n/g, "\r\n");
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([["0001_init.sql", checksum(crlf)]])
    });

    const output = await runMigrations({
      files: ["0001_init.sql"],
      readFile: () => lf,
      ledger,
      log: () => {}
    });

    expect(output).toEqual(["repaired 0001_init.sql"]);
    expect(ledger.appliedCalls).toEqual([]);
    expect(ledger.applied.get("0001_init.sql")).toBe(checksum(lf));
  });

  it("accepts only the reviewed 0022 checksum repair and converges the ledger without executing it", async () => {
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, LEGACY_BJX_CHECKSUM_LF]])
    });

    const output = await runMigrations({
      files: [BJX_MIGRATION_FILE],
      readFile: () => BJX_MIGRATION,
      ledger,
      log: () => {}
    });

    expect(output).toEqual([`repaired ${BJX_MIGRATION_FILE}`]);
    expect(ledger.appliedCalls).toEqual([]);
    expect(ledger.applied.get(BJX_MIGRATION_FILE)).toBe(
      checksum(BJX_MIGRATION)
    );

    const secondOutput = await runMigrations({
      files: [BJX_MIGRATION_FILE],
      readFile: () => BJX_MIGRATION,
      ledger,
      log: () => {}
    });
    expect(secondOutput).toEqual([`skipped ${BJX_MIGRATION_FILE}`]);
  });

  it("repairs a production CRLF ledger and converges to the current CRLF checksum", async () => {
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, LEGACY_BJX_CHECKSUM_CRLF]])
    });

    const output = await runMigrations({
      files: [BJX_MIGRATION_FILE],
      readFile: () => BJX_MIGRATION_CRLF,
      ledger,
      log: () => {}
    });

    expect(output).toEqual([`repaired ${BJX_MIGRATION_FILE}`]);
    expect(ledger.appliedCalls).toEqual([]);
    expect(ledger.applied.get(BJX_MIGRATION_FILE)).toBe(
      checksum(BJX_MIGRATION_CRLF)
    );
  });

  it("rejects an arbitrary on-disk 0022 rewrite against the production legacy ledger", () => {
    const sandbox = mkdtempSync(
      fileURLToPath(new URL("../../.migrate-review-", import.meta.url))
    );
    const scriptsDir = join(sandbox, "scripts");
    const migrationsDir = join(sandbox, "migrations");
    const rewrittenMigration = `${BJX_MIGRATION}\n-- arbitrary unreviewed rewrite\n`;

    try {
      mkdirSync(scriptsDir);
      mkdirSync(migrationsDir);
      writeFileSync(
        join(scriptsDir, "migrate.ts"),
        `${readFileSync(new URL("../migrate.ts", import.meta.url), "utf8")}
export { PUBLISHED_MIGRATION_REPAIRS };
`
      );
      writeFileSync(
        join(migrationsDir, BJX_MIGRATION_FILE),
        rewrittenMigration
      );

      const moduleUrl = pathToFileURL(join(scriptsDir, "migrate.ts")).href;
      const migrationPath = join(migrationsDir, BJX_MIGRATION_FILE);
      const probe = `
        import assert from "node:assert/strict";
        import { readFileSync } from "node:fs";
        const migration = await import(${JSON.stringify(moduleUrl)});
        const content = readFileSync(${JSON.stringify(migrationPath)}, "utf8");
        const repair = migration.PUBLISHED_MIGRATION_REPAIRS.get(${JSON.stringify(BJX_MIGRATION_FILE)});
        assert.equal(repair.current.has(migration.checksum(content)), false);
        const applied = new Map([[${JSON.stringify(BJX_MIGRATION_FILE)}, ${JSON.stringify(LEGACY_BJX_CHECKSUM_CRLF)}]]);
        const ledger = {
          async lock() {},
          async unlock() {},
          async ensureTable() {},
          async tableExists() { return true; },
          async getApplied() { return new Map(applied); },
          async insertBaselineRow() {},
          async repairChecksum(file, previousChecksum, currentChecksum) {
            assert.equal(applied.get(file), previousChecksum);
            applied.set(file, currentChecksum);
          },
          async applyMigration() { throw new Error("must not execute SQL"); }
        };
        await assert.rejects(
          migration.runMigrations({
            files: [${JSON.stringify(BJX_MIGRATION_FILE)}],
            readFile: () => content,
            ledger,
            log: () => {}
          }),
          /checksum mismatch/
        );
      `;
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", probe],
        {
          cwd: fileURLToPath(new URL("../..", import.meta.url)),
          encoding: "utf8"
        }
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it("rejects a legacy checksum outside the reviewed LF and CRLF variants", async () => {
    const unreviewedLegacyChecksum = checksum("unreviewed legacy 0022");
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, unreviewedLegacyChecksum]])
    });

    await expect(
      runMigrations({
        files: [BJX_MIGRATION_FILE],
        readFile: () => BJX_MIGRATION,
        ledger,
        log: () => {}
      })
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("still rejects any further change to the repaired 0022 migration", async () => {
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, LEGACY_BJX_CHECKSUM_LF]])
    });

    await expect(
      runMigrations({
        files: [BJX_MIGRATION_FILE],
        readFile: () => `${BJX_MIGRATION}\n-- unreviewed change\n`,
        ledger,
        log: () => {}
      })
    ).rejects.toThrow(/checksum mismatch/);
  });
});

describe("isBeginOrCommit", () => {
  it("matches a bare BEGIN/COMMIT even with leading comment lines from splitStatements", () => {
    expect(
      isBeginOrCommit("-- 0011_sources_seed_v2.sql\n-- some notes\n\nBEGIN")
    ).toBe(true);
    expect(isBeginOrCommit("COMMIT")).toBe(true);
    expect(isBeginOrCommit("commit")).toBe(true);
  });

  it("does not match real statements or commented-out rollback blocks", () => {
    expect(isBeginOrCommit("CREATE TABLE foo (id int)")).toBe(false);
    expect(isBeginOrCommit("/*\nBEGIN;\nDROP TABLE foo;\nCOMMIT;\n*/")).toBe(
      false
    );
  });
});

describe("splitStatements", () => {
  it("keeps dollar-quoted DO blocks intact as a single statement", () => {
    const sql =
      "BEGIN;\nDO $$\nBEGIN\n  RAISE NOTICE 'hi;there';\nEND\n$$;\nCOMMIT;\n";
    const statements = splitStatements(sql);
    expect(statements).toEqual([
      "BEGIN",
      "DO $$\nBEGIN\n  RAISE NOTICE 'hi;there';\nEND\n$$",
      "COMMIT"
    ]);
  });
});
