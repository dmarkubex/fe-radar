import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "../client";
import { updateSource } from "../repos/sources";

const migrationPath = resolve(
  __dirname,
  "../../migrations/0036_sources_url_locked.sql"
);
const migration0035Path = resolve(
  __dirname,
  "../../migrations/0035_sources_admin_snapshot.sql"
);

type SmmRow = {
  id: number;
  enabled: boolean;
  adminTouchedAt: Date | null;
  adminSnapshot: { enabled?: boolean; config?: unknown } | null;
  urlLocked: boolean;
};

/**
 * Mirrors 0035 restore semantics for the enabled key only (enough for this regression).
 */
function applyAdminSnapshotRestore(rows: SmmRow[]): SmmRow[] {
  return rows.map((row) => {
    if (row.adminTouchedAt == null || row.adminSnapshot == null) return row;
    if (row.adminSnapshot.enabled === undefined) return row;
    if (row.enabled === row.adminSnapshot.enabled) return row;
    return { ...row, enabled: row.adminSnapshot.enabled };
  });
}

/**
 * Policy mirror only, not real SQL execution. If this repository later adds pglite,
 * testcontainers, or another real Postgres test harness, replace this with execution of
 * 0035/0036 and assert the terminal rows. This test cannot catch SQL syntax errors or
 * Postgres jsonb operator differences, including the exact semantics of `?`.
 */
function applyUrlLockedReconciliation(rows: SmmRow[]): SmmRow[] {
  const ranked = [...rows]
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.id - b.id;
    })
    .map((row, index) => ({ row, sourceRank: index + 1 }));

  return ranked.map(({ row, sourceRank }) => {
    const nextEnabled =
      sourceRank === 1
        ? row.enabled
        : Object.prototype.hasOwnProperty.call(row.adminSnapshot ?? {}, "enabled")
          ? row.enabled
          : false;
    return { ...row, urlLocked: true, enabled: nextEnabled };
  });
}

describe("0036 sources URL lock reconciliation", () => {
  it("locks seed rows by stable SMM config fingerprint even after the URL changed", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");

    expect(migrationSql).toMatch(
      /ADD COLUMN IF NOT EXISTS url_locked BOOLEAN NOT NULL DEFAULT false/i
    );
    expect(migrationSql).toContain("fetcher_type = 'quotes'");
    expect(migrationSql).toContain("config->>'adapter' = 'smm-hq'");
    expect(migrationSql).toContain(
      "(config->'metric_keys') ?| ARRAY['cu_main_close', 'lc_main_close']"
    );
    expect(migrationSql).toContain("(config->'metric_keys') ? 'cu_main_close'");
    expect(migrationSql).toContain("(config->'metric_keys') ? 'lc_main_close'");
    expect(migrationSql).toContain(
      "OR url IN ('https://hq.smm.cn/h5/cu', 'https://hq.smm.cn/h5/Li2CO3')"
    );
    expect(migrationSql).toContain("SET url_locked = true");
  });

  it("groups fingerprint OR url match with outer parentheses", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");
    expect(migrationSql).toMatch(
      /WHERE \(\s*\(\s*fetcher_type = 'quotes'/s
    );
  });

  it("documents admin-intent-safe ranking and disable guards", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");

    expect(migrationSql).toContain("CASE WHEN enabled THEN 0 ELSE 1 END");
    expect(migrationSql).toContain("WHEN ranked.admin_snapshot ? 'enabled' THEN source.enabled");
    expect(migrationSql).toContain("admin-intent protection");
    expect(migrationSql).toContain(
      "without deleting rows that may already have foreign-key references"
    );
  });

  it("preserves admin-enabled higher-id duplicate across 0035 then 0036 replay", async () => {
    // Regression for Round 6 Finding 1 / Finding 2 acceptance scenario:
    // admin enables the larger-id (0027-replay) row via updateSource → admin_snapshot;
    // migrate.ts replays 0035 then 0036; that row must stay enabled=true.
    const migration0035 = readFileSync(migration0035Path, "utf8");
    const migration0036 = readFileSync(migrationPath, "utf8");
    expect(migration0035).toContain("admin_snapshot->>'enabled'");
    expect(migration0036).toContain("admin_snapshot ? 'enabled'");

    // After 0027 replay + 0033 fingerprint disable, both siblings are disabled.
    // Admin then enables id=20 (seed-URL duplicate) through the API.
    let updatePatch: Record<string, unknown> | undefined;
    const returning = vi.fn().mockResolvedValue([{ id: 20 }]);
    const updateWhere = vi.fn().mockReturnValue({ returning });
    const set = vi.fn((patch: Record<string, unknown>) => {
      updatePatch = patch;
      return { where: updateWhere };
    });
    const currentWhere = vi.fn().mockResolvedValue([{
      url: "https://hq.smm.cn/h5/Li2CO3",
      fetcherType: "quotes",
      config: { adapter: "smm-hq", metric_keys: ["lc_main_close"] },
      urlLocked: true
    }]);
    const siblingsWhere = vi.fn().mockResolvedValue([{
      id: 10,
      url: "https://example.com/admin-edited-lc",
      fetcherType: "quotes",
      config: { adapter: "smm-hq", metric_keys: ["lc_main_close"] },
      enabled: false
    }]);
    const db = {
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: currentWhere }) })
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: siblingsWhere }) }),
      update: vi.fn().mockReturnValue({ set })
    } as unknown as DbClient;

    await updateSource(db, 20, { enabled: true });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      adminTouchedAt: expect.any(Date),
      adminSnapshot: expect.objectContaining({
        queryChunks: expect.arrayContaining([JSON.stringify({ enabled: true })])
      })
    }));

    const snapshotJson = (updatePatch?.adminSnapshot as { queryChunks?: unknown[] })
      .queryChunks?.find((chunk): chunk is string => typeof chunk === "string" && chunk === JSON.stringify({ enabled: true }));
    expect(snapshotJson).toBeDefined();
    const snapshotPatch = JSON.parse(snapshotJson!) as SmmRow["adminSnapshot"];
    const afterAdminEnable: SmmRow[] = [
      {
        id: 10,
        enabled: false,
        adminTouchedAt: null,
        adminSnapshot: null,
        urlLocked: false
      },
      {
        id: 20,
        enabled: updatePatch?.enabled === true,
        adminTouchedAt: updatePatch?.adminTouchedAt as Date,
        adminSnapshot: snapshotPatch,
        urlLocked: false
      }
    ];

    // Next deploy: 0027 forces enabled=true on the seed-URL row, 0033 may disable
    // untouched originals, then 0035 restores snapshot before 0036 runs.
    const after0027Clobber: SmmRow[] = [
      afterAdminEnable[0]!,
      { ...afterAdminEnable[1]!, enabled: false } // simulate clobber before 0035
    ];
    const after0035 = applyAdminSnapshotRestore(after0027Clobber);
    expect(after0035.find((r) => r.id === 20)?.enabled).toBe(true);

    const after0036 = applyUrlLockedReconciliation(after0035);
    const higherId = after0036.find((r) => r.id === 20);
    const lowerId = after0036.find((r) => r.id === 10);

    expect(higherId?.enabled).toBe(true);
    expect(higherId?.urlLocked).toBe(true);
    expect(lowerId?.enabled).toBe(false);
    expect(lowerId?.urlLocked).toBe(true);
  });

  it("still disables untouched 0027-replay duplicates when the older row stays disabled", () => {
    const rows: SmmRow[] = [
      {
        id: 10,
        enabled: false,
        adminTouchedAt: null,
        adminSnapshot: null,
        urlLocked: false
      },
      {
        id: 20,
        enabled: false,
        adminTouchedAt: null,
        adminSnapshot: null,
        urlLocked: false
      }
    ];

    const after0036 = applyUrlLockedReconciliation(rows);
    expect(after0036.find((r) => r.id === 10)).toMatchObject({
      enabled: false,
      urlLocked: true
    });
    expect(after0036.find((r) => r.id === 20)).toMatchObject({
      enabled: false,
      urlLocked: true
    });
  });

  it("disables a replayed duplicate when admin changed only its name", () => {
    const adminTouchedAt = new Date("2026-07-17T08:00:00.000Z");
    const beforeReplay: SmmRow[] = [
      {
        id: 10,
        enabled: true,
        adminTouchedAt: null,
        adminSnapshot: null,
        urlLocked: false
      },
      {
        id: 20,
        enabled: false,
        adminTouchedAt,
        adminSnapshot: {},
        urlLocked: false
      }
    ];

    // 0027 re-enables the duplicate; 0035 cannot restore enabled because a name-only
    // update records admin_touched_at but intentionally leaves no enabled snapshot key.
    const after0027Clobber = beforeReplay.map((row) =>
      row.id === 20 ? { ...row, enabled: true } : row
    );
    const after0035 = applyAdminSnapshotRestore(after0027Clobber);
    expect(after0035.find((row) => row.id === 20)?.enabled).toBe(true);

    const after0036 = applyUrlLockedReconciliation(after0035);
    expect(after0036.find((row) => row.id === 20)).toMatchObject({
      enabled: false,
      adminTouchedAt,
      adminSnapshot: {},
      urlLocked: true
    });
  });
});
