import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { scoringReprocessRuns, scoringReprocessTargets } from "../schema";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0053_scoring_reprocess_checkpoint.sql"),
  "utf8"
);

describe("0053 scoring reprocess checkpoint migration", () => {
  it("stores only a fixed run window and per-item checkpoints", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS scoring_reprocess_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS scoring_reprocess_targets/i);
    expect(sql).toMatch(/PRIMARY KEY \(run_id, item_id\)/i);
    expect(sql).toMatch(/CHECK \(from_at < until_at\)/i);
    expect(sql).not.toMatch(/\b(title|content|summary_zh|quality_score)\b/i);
  });

  it("uses fail-closed statuses and cascading foreign keys", () => {
    for (const status of ["prepared", "running", "completed", "failed"])
      expect(sql).toContain(`'${status}'`);
    for (const status of ["pending", "skipped_filter", "pending_quota"])
      expect(sql).toContain(`'${status}'`);

    expect(sql).toMatch(/REFERENCES scoring_reprocess_runs\(run_id\) ON DELETE CASCADE/i);
    expect(sql).toMatch(/REFERENCES items\(id\) ON DELETE CASCADE/i);
    expect(sql).toContain("scoring_reprocess_targets_run_status_updated_idx");
    expect(sql).toContain("scoring_reprocess_targets_item_idx");
  });

  it("exports matching Drizzle table columns", () => {
    expect(scoringReprocessRuns.runId).toBeDefined();
    expect(scoringReprocessRuns.fromAt).toBeDefined();
    expect(scoringReprocessRuns.untilAt).toBeDefined();
    expect(scoringReprocessRuns.status).toBeDefined();
    expect(scoringReprocessRuns.completedAt).toBeDefined();
    expect(scoringReprocessTargets.runId).toBeDefined();
    expect(scoringReprocessTargets.itemId).toBeDefined();
    expect(scoringReprocessTargets.attempts).toBeDefined();
    expect(scoringReprocessTargets.lastError).toBeDefined();
  });
});
