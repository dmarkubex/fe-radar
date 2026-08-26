import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0070_timeline_list_indexes.sql"),
  "utf8"
);

describe("0070 timeline list indexes", () => {
  it("adds item_id and scored_at indexes idempotently", () => {
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS cluster_items_item_id_idx");
    expect(sql).toContain("ON cluster_items (item_id)");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS analysis_scored_at_idx");
    expect(sql).toContain("ON item_analysis (scored_at DESC)");
    expect(sql).toContain("WHERE scored_at IS NOT NULL");
    expect(sql).not.toMatch(/CONCURRENTLY/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });

  it("analyzes the list-query tables", () => {
    expect(sql).toContain("ANALYZE items;");
    expect(sql).toContain("ANALYZE item_analysis;");
    expect(sql).toContain("ANALYZE cluster_items;");
    expect(sql).toContain("ANALYZE clusters;");
  });
});
