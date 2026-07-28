import { readFileSync } from "node:fs";
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
const LEGACY_BJX_CHECKSUM =
  "5f43113c2ceac0acfa731dca73bc2b4dd5a14cba0fcb8e74b4088456ec9e56c7";

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

  it("accepts only the reviewed 0022 checksum repair and converges the ledger without executing it", async () => {
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, LEGACY_BJX_CHECKSUM]])
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

  it("still rejects any further change to the repaired 0022 migration", async () => {
    const ledger = new FakeLedger({
      sourcesExists: true,
      seed: new Map([[BJX_MIGRATION_FILE, LEGACY_BJX_CHECKSUM]])
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
