import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { dailyPushConfig, dailyPushes } from "../schema-commodity";

const sql = readFileSync(
  resolve(__dirname, "../../migrations/0055_daily_push_config.sql"),
  "utf8"
);

describe("0055 daily push config migration", () => {
  it("creates singleton daily_push_config with safe defaults", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS daily_push_config/i);
    expect(sql).toMatch(/PRIMARY KEY CHECK \(id = 1\)/i);
    expect(sql).toMatch(/DEFAULT FALSE/i);
    expect(sql).toContain("'16:15'");
    expect(sql).toContain("'business_days'");
    expect(sql).toContain("'http://fe-radar.internal'");
    expect(sql).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(sql).toMatch(/send_time ~ /i);
    expect(sql).toMatch(/schedule_mode IN \('daily', 'business_days'\)/i);
  });

  it("creates daily_pushes audit with unique (report_date, target_id)", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS daily_pushes/i);
    expect(sql).toMatch(/UNIQUE \(report_date, target_id\)/i);
    expect(sql).toMatch(/REFERENCES briefing_targets\(id\)/i);
    expect(sql).toMatch(/REFERENCES commodity_briefings\(id\) ON DELETE SET NULL/i);
    expect(sql).toMatch(/push_status IN \('pending', 'succeeded', 'failed'\)/i);
    expect(sql).toContain("daily_report_present");
    expect(sql).toContain("briefing_present");
  });

  it("includes comment-form rollback and does not auto-run it", () => {
    expect(sql).toMatch(/--\s*ROLLBACK/i);
    expect(sql).toMatch(/--\s*DROP TABLE IF EXISTS daily_pushes/i);
    expect(sql).toMatch(/--\s*DROP TABLE IF EXISTS daily_push_config/i);
    expect(sql).not.toMatch(/^\s*DROP TABLE IF EXISTS daily_pushes/m);
    expect(sql).not.toMatch(/^\s*DROP TABLE IF EXISTS daily_push_config/m);
  });

  it("exports matching Drizzle table columns without phantom id default", () => {
    expect(dailyPushConfig.id).toBeDefined();
    // Align with 0055: id has CHECK (id=1) + seed, no SQL DEFAULT — Drizzle must not invent one.
    expect(dailyPushConfig.id.hasDefault).toBe(false);
    expect(dailyPushConfig.enabled).toBeDefined();
    expect(dailyPushConfig.sendTime).toBeDefined();
    expect(dailyPushConfig.scheduleMode).toBeDefined();
    expect(dailyPushConfig.baseUrl).toBeDefined();
    expect(dailyPushConfig.updatedBy).toBeDefined();
    expect(dailyPushConfig.updatedAt).toBeDefined();

    expect(dailyPushes.id).toBeDefined();
    expect(dailyPushes.reportDate).toBeDefined();
    expect(dailyPushes.targetId).toBeDefined();
    expect(dailyPushes.briefingId).toBeDefined();
    expect(dailyPushes.dailyReportPresent).toBeDefined();
    expect(dailyPushes.briefingPresent).toBeDefined();
    expect(dailyPushes.pushStatus).toBeDefined();
    expect(dailyPushes.attemptCount).toBeDefined();
    expect(dailyPushes.errorDetail).toBeDefined();
    expect(dailyPushes.pushedAt).toBeDefined();
  });
});
