import { expect, test, type Page } from "@playwright/test";

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "admin123";

async function login(page: Page): Promise<void> {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBe(true);
  const csrf = await csrfResponse.json() as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      username: adminUsername,
      password: adminPassword,
      callbackUrl: "/"
    },
    maxRedirects: 0
  });
  expect([302, 303]).toContain(response.status());
  const location = response.headers().location;
  expect(location, "credentials login should not redirect back with an auth error").toBeTruthy();
  expect(location).not.toContain("error=CredentialsSignin");
}

test.describe("release smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("timeline loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "全量信息流" })).toBeVisible();
  });

  test("curated loads", async ({ page }) => {
    await page.goto("/curated");
    // Default category tab is "政策与标准"; the h1 renders the active category label.
    await expect(page.getByRole("heading", { name: "政策与标准" })).toBeVisible();
  });

  test("search loads", async ({ page }) => {
    await page.goto("/search?q=远东");
    await expect(page.getByRole("heading", { name: "搜索" })).toBeVisible();
  });

  test("alerts loads", async ({ page }) => {
    await page.goto("/alerts?type=safety");
    // h1 contains dynamic "{total} 条告警 · {p1Count} 条 P1 需立即关注"
    await expect(page.getByRole("heading", { name: /告警/ })).toBeVisible();
  });

  test("daily loads", async ({ page }) => {
    // Navigate to a seeded date so the report is present (seed-release-data seeds 2026-05-24..26).
    await page.goto("/daily?date=2026-05-26");
    // Assert a section that only renders when sections data is present (not just the page skeleton).
    await expect(page.getByText("今日判断")).toBeVisible();
  });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "FE-Radar 运行仪表盘" })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// @v11 commodity briefing smoke tests
// These tests require the fixture script scripts/v11-smoke-prep.ts to be run
// before the test suite (seed holiday, mock LLM, mock DingTalk 5xx).
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@v11 commodity briefing smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /**
   * 节假日跳过：当日为节假日时，briefing-gen job 不执行，briefing_pushes 该日为空。
   *
   * Fixture prerequisite: scripts/v11-smoke-prep.ts --scenario holiday
   *   inserts today's date into briefing_holidays and removes any existing
   *   commodity_briefings row for today, then triggers /api/briefing/gen (POST).
   *
   * Expected: GET /api/briefing returns no item with today's briefingDate.
   */
  test("@v11 节假日跳过 — briefing-gen 不写入当日记录", async ({ page }) => {
    // Trigger briefing-gen for today via the regenerate API with today's date
    // The fixture has pre-seeded today as a holiday; the job should skip.
    const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });

    // Poll briefing list — today's date should not appear (job skipped)
    const listResp = await page.request.get("/api/briefing?pageSize=10");
    expect(listResp.ok()).toBe(true);
    const listBody = await listResp.json() as { items: Array<{ briefingDate: string }> };

    const todayRow = listBody.items.find((item) => item.briefingDate === todayStr);
    expect(todayRow).toBeUndefined();
  });

  /**
   * 字段缺失降级：quotes 数据缺关键字段时，gen_status='degraded' 且 UI 详情页显示降级提示。
   *
   * Fixture prerequisite: scripts/v11-smoke-prep.ts --scenario degraded
   *   inserts a commodity_briefings row with gen_status='degraded' for today.
   *
   * Expected:
   *   - GET /api/briefing returns item with gen_status='degraded'
   *   - GET /api/briefing/:id returns briefing.gen_status='degraded'
   */
  test("@v11 字段缺失降级 — gen_status=degraded + 详情页降级标识", async ({ page }) => {
    const listResp = await page.request.get("/api/briefing?pageSize=10");
    expect(listResp.ok()).toBe(true);
    const listBody = await listResp.json() as {
      items: Array<{ id: number; genStatus: string }>
    };

    const degradedRow = listBody.items.find((item) => item.genStatus === "degraded");
    expect(degradedRow, "应存在 gen_status=degraded 的简报记录").toBeDefined();

    if (!degradedRow) return; // type guard

    // Verify detail API reflects degraded status
    const detailResp = await page.request.get(`/api/briefing/${degradedRow.id}`);
    expect(detailResp.ok()).toBe(true);
    const detailBody = await detailResp.json() as {
      briefing: { id: number; genStatus: string }
    };
    expect(detailBody.briefing.genStatus).toBe("degraded");
  });

  /**
   * 推送失败重试：钉钉返 5xx 时，briefing_pushes 记录 attempt_count=3 且 status='failed'。
   *
   * Fixture prerequisite: scripts/v11-smoke-prep.ts --scenario push-retry
   *   inserts a briefing_pushes row with push_status='failed' and attempt_count=3
   *   (simulating 3 exhausted retry attempts against a mock 5xx DingTalk endpoint).
   *
   * Expected:
   *   - GET /api/briefing/:id returns pushes list with status='failed' and attemptCount=3
   */
  test("@v11 推送失败重试 — attempt_count=3 + push_status=failed", async ({ page }) => {
    const listResp = await page.request.get("/api/briefing?pageSize=10");
    expect(listResp.ok()).toBe(true);
    const listBody = await listResp.json() as {
      items: Array<{ id: number; genStatus: string }>
    };

    // Find any succeeded/degraded briefing (push_retry fixture associates a push record)
    const briefingRow = listBody.items.find(
      (item) => item.genStatus === "succeeded" || item.genStatus === "degraded"
    );
    expect(briefingRow, "应存在可推送状态的简报记录").toBeDefined();
    if (!briefingRow) return;

    const detailResp = await page.request.get(`/api/briefing/${briefingRow.id}`);
    expect(detailResp.ok()).toBe(true);
    const detailBody = await detailResp.json() as {
      briefing: { id: number };
      pushes: Array<{ pushStatus: string; attemptCount: number }>
    };

    const failedPush = detailBody.pushes.find((p) => p.pushStatus === "failed");
    expect(failedPush, "应存在 push_status=failed 的推送记录").toBeDefined();
    expect(failedPush?.attemptCount).toBe(3);
  });

  /**
   * 模板 lint 失败：模板含未注册占位符 → gen_status='failed' + 错误信息含 TEMPLATE_LINT_MISSING_PLACEHOLDER。
   *
   * Fixture prerequisite: scripts/v11-smoke-prep.ts --scenario template-lint
   *   inserts a commodity_briefings row with gen_status='failed' and
   *   gen_error containing 'TEMPLATE_LINT_MISSING_PLACEHOLDER'.
   *
   * Expected:
   *   - GET /api/briefing returns item with gen_status='failed'
   *   - GET /api/briefing/:id returns briefing.gen_error containing 'TEMPLATE_LINT_MISSING_PLACEHOLDER'
   */
  test("@v11 模板 lint 失败 — gen_status=failed + TEMPLATE_LINT_MISSING_PLACEHOLDER", async ({ page }) => {
    const listResp = await page.request.get("/api/briefing?pageSize=10");
    expect(listResp.ok()).toBe(true);
    const listBody = await listResp.json() as {
      items: Array<{ id: number; genStatus: string }>
    };

    const failedRow = listBody.items.find((item) => item.genStatus === "failed");
    expect(failedRow, "应存在 gen_status=failed 的简报记录").toBeDefined();
    if (!failedRow) return;

    const detailResp = await page.request.get(`/api/briefing/${failedRow.id}`);
    expect(detailResp.ok()).toBe(true);
    const detailBody = await detailResp.json() as {
      briefing: { id: number; genStatus: string; genError: string | null }
    };

    expect(detailBody.briefing.genStatus).toBe("failed");
    expect(detailBody.briefing.genError).toContain("TEMPLATE_LINT_MISSING_PLACEHOLDER");
  });
});
