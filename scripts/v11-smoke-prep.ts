/**
 * v11-smoke-prep.ts
 *
 * Smoke test fixture injector for @v11 commodity briefing E2E tests (T-CB-20).
 *
 * Usage:
 *   pnpm tsx scripts/v11-smoke-prep.ts --all
 *   pnpm tsx scripts/v11-smoke-prep.ts --scenario holiday
 *   pnpm tsx scripts/v11-smoke-prep.ts --scenario degraded
 *   pnpm tsx scripts/v11-smoke-prep.ts --scenario push-retry
 *   pnpm tsx scripts/v11-smoke-prep.ts --scenario template-lint
 *
 * Idempotent: safe to run multiple times.
 * Requires DATABASE_URL environment variable.
 */

import { eq, and } from "drizzle-orm";
import {
  getDb,
  briefingHolidays,
  commodityBriefings,
  briefingPushes,
  briefingTargets,
} from "@fe-radar/db";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function log(msg: string): void {
  process.stdout.write(`[v11-smoke-prep] ${msg}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: holiday
// Insert today into briefing_holidays; remove today's commodity_briefings row.
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioHoliday(): Promise<void> {
  log("scenario: holiday");
  const db = getDb();
  const today = todayStr();

  // Insert holiday row (ignore conflict if already exists)
  await db
    .insert(briefingHolidays)
    .values({ holidayDate: today, name: "E2E smoke 测试节假日" })
    .onConflictDoNothing();
  log(`  inserted briefing_holidays.holiday_date = ${today}`);

  // Remove today's commodity_briefings row so the test can assert absence
  await db
    .delete(commodityBriefings)
    .where(eq(commodityBriefings.briefingDate, today));
  log(`  deleted commodity_briefings for briefing_date = ${today}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: degraded
// Insert a commodity_briefings row with gen_status='degraded' for today.
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioDegraded(): Promise<void> {
  log("scenario: degraded");
  const db = getDb();
  const today = todayStr();

  // Remove any conflicting row for today first (holiday scenario may have cleared it)
  await db
    .delete(commodityBriefings)
    .where(
      and(
        eq(commodityBriefings.briefingDate, today),
        eq(commodityBriefings.genStatus, "degraded")
      )
    );

  await db.insert(commodityBriefings).values({
    briefingDate: today,
    templateVersion: 1,
    payloadJson: {
      _smokeFixture: true,
      _degradedReason: "cu_main_close missing — E2E fixture",
      cu: { logic_summary: "降级占位", outlook: { trend: "数据不足", support: null, resistance: null } },
      lc: { logic_summary: "降级占位", outlook: { trend: "数据不足", support: null, resistance: null } },
      macro_summary: "E2E smoke fixture — degraded",
      risk_notes: ["字段覆盖率不足"],
      procurement_advice: "暂无建议",
    },
    docxPath: null,
    genStatus: "degraded",
    genError: null,
    generatedAt: new Date(),
  });
  log(`  inserted commodity_briefings(gen_status=degraded) for ${today}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: push-retry
// For the latest succeeded/degraded briefing, insert a briefing_pushes row
// with push_status='failed' and attempt_count=3.
// Creates a stub briefing_targets row if none exists.
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioPushRetry(): Promise<void> {
  log("scenario: push-retry");
  const db = getDb();

  // Find latest pushable briefing
  const [briefing] = await db
    .select({ id: commodityBriefings.id, briefingDate: commodityBriefings.briefingDate })
    .from(commodityBriefings)
    .orderBy(commodityBriefings.id)
    .limit(1);

  if (!briefing) {
    // No briefing exists yet — create a stub succeeded one for yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const [inserted] = await db
      .insert(commodityBriefings)
      .values({
        briefingDate: yesterdayStr,
        templateVersion: 1,
        payloadJson: { _smokeFixture: true },
        docxPath: null,
        genStatus: "succeeded",
        genError: null,
        generatedAt: new Date(),
      })
      .returning({ id: commodityBriefings.id });
    if (!inserted) throw new Error("Failed to insert stub briefing for push-retry");
    log(`  inserted stub commodity_briefings(id=${inserted.id}) for ${yesterdayStr}`);
    const briefingId = inserted.id;
    await insertPushRecord(db, briefingId);
    return;
  }

  await insertPushRecord(db, briefing.id);
}

async function insertPushRecord(
  db: ReturnType<typeof getDb>,
  briefingId: number
): Promise<void> {
  // Ensure at least one target exists
  const [target] = await db
    .select({ id: briefingTargets.id })
    .from(briefingTargets)
    .limit(1);

  let targetId: number;
  if (target) {
    targetId = target.id;
  } else {
    // Insert stub target
    const [inserted] = await db
      .insert(briefingTargets)
      .values({
        name: "E2E smoke 钉钉群",
        webhookUrl: "https://mock-dingtalk.internal/robot/send?access_token=smoke",
        signSecret: null,
        enabled: true,
        disabledAt: null,
        createdAt: new Date(),
      })
      .returning({ id: briefingTargets.id });
    if (!inserted) throw new Error("Failed to insert stub briefing_target");
    targetId = inserted.id;
    log(`  inserted stub briefing_targets(id=${targetId})`);
  }

  // Upsert push record with failed status + attempt_count=3
  await db
    .insert(briefingPushes)
    .values({
      briefingId,
      targetId,
      pushStatus: "failed",
      attemptCount: 3,
      errorDetail: "E2E smoke fixture: mock DingTalk 5xx — HTTP 500 Internal Server Error",
      pushedAt: null,
    })
    .onConflictDoUpdate({
      target: [briefingPushes.briefingId, briefingPushes.targetId],
      set: {
        pushStatus: "failed",
        attemptCount: 3,
        errorDetail: "E2E smoke fixture: mock DingTalk 5xx — HTTP 500 Internal Server Error",
        pushedAt: null,
      },
    });
  log(`  upserted briefing_pushes(briefingId=${briefingId}, targetId=${targetId}, status=failed, attempts=3)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario: template-lint
// Insert a commodity_briefings row with gen_status='failed' and gen_error
// containing 'TEMPLATE_LINT_MISSING_PLACEHOLDER'.
// ─────────────────────────────────────────────────────────────────────────────

async function scenarioTemplateLint(): Promise<void> {
  log("scenario: template-lint");
  const db = getDb();

  // Use a date 2 days ago to avoid conflict with holiday/degraded fixtures for today
  const d = new Date();
  d.setDate(d.getDate() - 2);
  const dateStr = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

  // Remove any existing failed row for that date
  await db
    .delete(commodityBriefings)
    .where(
      and(
        eq(commodityBriefings.briefingDate, dateStr),
        eq(commodityBriefings.genStatus, "failed")
      )
    );

  await db.insert(commodityBriefings).values({
    briefingDate: dateStr,
    templateVersion: 1,
    payloadJson: {},
    docxPath: null,
    genStatus: "failed",
    genError:
      "BriefingRenderError [TEMPLATE_LINT_MISSING_PLACEHOLDER]: Template contains unregistered placeholder(s): unknown_placeholder_smoke — E2E fixture",
    generatedAt: new Date(),
  });
  log(`  inserted commodity_briefings(gen_status=failed, gen_error~TEMPLATE_LINT_MISSING_PLACEHOLDER) for ${dateStr}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const runAll = args.includes("--all");
const scenarioArg = (() => {
  const idx = args.indexOf("--scenario");
  return idx !== -1 ? args[idx + 1] : undefined;
})();

async function main(): Promise<void> {
  if (!runAll && !scenarioArg) {
    process.stderr.write(
      "Usage: pnpm tsx scripts/v11-smoke-prep.ts --all\n" +
      "       pnpm tsx scripts/v11-smoke-prep.ts --scenario <holiday|degraded|push-retry|template-lint>\n"
    );
    process.exit(1);
  }

  const scenarios: Record<string, () => Promise<void>> = {
    holiday: scenarioHoliday,
    degraded: scenarioDegraded,
    "push-retry": scenarioPushRetry,
    "template-lint": scenarioTemplateLint,
  };

  if (runAll) {
    for (const [name, fn] of Object.entries(scenarios)) {
      log(`running scenario: ${name}`);
      await fn();
    }
  } else if (scenarioArg) {
    const fn = scenarios[scenarioArg];
    if (!fn) {
      process.stderr.write(`Unknown scenario: ${scenarioArg}\n`);
      process.exit(1);
    }
    await fn();
  }

  log("done.");
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`[v11-smoke-prep] fatal: ${String(err)}\n`);
  process.exit(1);
});
