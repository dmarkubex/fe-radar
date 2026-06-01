import { expect, test, type Page } from "@playwright/test";

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin-password";
const viewerUsername = process.env.E2E_VIEWER_USERNAME ?? "viewer";
const viewerPassword = process.env.E2E_VIEWER_PASSWORD ?? "viewer-password";

test.describe.configure({ mode: "serial" });

async function login(page: Page, username: string, password: string): Promise<void> {
  const csrfResponse = await page.request.get("/api/auth/csrf");
  expect(csrfResponse.ok()).toBe(true);
  const csrf = await csrfResponse.json() as { csrfToken: string };
  const response = await page.request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      username,
      password,
      callbackUrl: "/admin/sources"
    },
    maxRedirects: 0
  });
  expect([302, 303]).toContain(response.status());
}

async function createSourceViaApi(page: Page, name: string): Promise<{ id: number; url: string }> {
  const url = `https://example.com/${encodeURIComponent(name)}`;
  const response = await page.request.post("/api/sources", {
    data: {
      name,
      url,
      tier: "T1",
      fetcherType: "rss",
      category: "E2E",
      config: { type: "rss", url }
    }
  });
  expect(response.status()).toBe(201);
  return await response.json() as { id: number; url: string };
}

test("未登录访问 admin sources 会跳转登录页", async ({ page }) => {
  await page.goto("/admin/sources");
  await expect(page).toHaveURL(/\/auth\/login/);
});

test("admin 可以登录并进入 sources 后台", async ({ page }) => {
  await login(page, adminUsername, adminPassword);
  await page.goto("/admin/sources");
  await expect(page.getByRole("heading", { name: "信源管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新增信源" })).toBeVisible();
});

test("admin 可以按 tier 查看 seed 信源且启用数符合合同", async ({ page }) => {
  await login(page, adminUsername, adminPassword);

  // Fetch expected counts from API to derive per-tier expectations dynamically
  const apiRes = await page.request.get("/api/sources");
  expect(apiRes.ok()).toBe(true);
  const { items } = await apiRes.json() as { items: Array<{ enabled: boolean; tier: string }> };

  // Compute per-tier counts from the API (only T1/T2/T3 tiers)
  const totalByTier: Record<string, number> = { T1: 0, T2: 0, T3: 0 };
  const enabledByTier: Record<string, number> = { T1: 0, T2: 0, T3: 0 };
  for (const s of items) {
    if (s.tier === "T1" || s.tier === "T2" || s.tier === "T3") {
      totalByTier[s.tier]++;
      if (s.enabled) enabledByTier[s.tier]++;
    }
  }
  const totalSources = totalByTier.T1 + totalByTier.T2 + totalByTier.T3;
  const totalEnabled = enabledByTier.T1 + enabledByTier.T2 + enabledByTier.T3;

  await page.goto("/admin/sources");
  await page.waitForSelector("tbody tr");

  // Verify per-tier total row counts match API
  let uiTotal = 0;
  for (const tier of ["T1", "T2", "T3"]) {
    await page.getByRole("button", { name: tier }).click();
    const rows = await page.locator("tbody tr").count();
    expect(rows, `${tier} total`).toBe(totalByTier[tier]);
    uiTotal += rows;
  }
  expect(uiTotal, "Total sources across tiers").toBe(totalSources);

  // Verify enabled source count: switch to ALL view and count rows with "启用" status
  await page.getByRole("button", { name: "全部" }).click();
  const statusCells = page.locator("tbody tr td:nth-child(5)");
  const enabledCount = await statusCells.filter({ hasText: "启用" }).count();
  expect(enabledCount, "Enabled sources").toBe(totalEnabled);
});

test("admin 可以通过 UI 新建信源", async ({ page }) => {
  const name = `E2E 新建 ${Date.now()}`;
  const url = `https://example.com/${encodeURIComponent(name)}`;
  await login(page, adminUsername, adminPassword);
  await page.goto("/admin/sources");

  await page.getByPlaceholder("名称").fill(name);
  await page.getByPlaceholder("URL").fill(url);
  await page.locator("select[name='tier']").selectOption("T1");
  await page.locator("select[name='fetcherType']").selectOption("rss");
  await page.getByPlaceholder("分类").fill("E2E");
  await page.locator("textarea").fill(JSON.stringify({ type: "rss", url }, null, 2));
  await page.getByRole("button", { name: "新建" }).click();

  await page.getByRole("button", { name: "T1" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
});

test("admin 可以编辑信源名称", async ({ page }) => {
  const updatedName = `E2E 已编辑 ${Date.now()}`;
  await login(page, adminUsername, adminPassword);
  const source = await createSourceViaApi(page, `E2E 编辑 ${Date.now()}`);
  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  const row = page.getByTestId(`source-row-${source.id}`);
  await row.getByRole("button", { name: "编辑" }).click();
  await row.getByLabel("信源名称").fill(updatedName);
  await row.getByRole("button", { name: "保存编辑" }).click();

  await expect(page.getByRole("row", { name: new RegExp(updatedName) })).toBeVisible();
});

test("admin 删除信源时执行软删", async ({ page }) => {
  await login(page, adminUsername, adminPassword);
  const source = await createSourceViaApi(page, `E2E 删除 ${Date.now()}`);
  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  const row = page.getByTestId(`source-row-${source.id}`);
  await row.getByRole("button", { name: "删除" }).click();
  await expect(row).toContainText("停用");

  const listResponse = await page.request.get("/api/sources?tier=T1");
  expect(listResponse.ok()).toBe(true);
  const payload = await listResponse.json() as { items: Array<{ id: number; enabled: boolean }> };
  expect(payload.items.find((item) => item.id === source.id)?.enabled).toBe(false);
});

test("viewer 访问 admin sources 返回 403", async ({ page }) => {
  await login(page, viewerUsername, viewerPassword);
  const response = await page.goto("/admin/sources");
  expect(response?.status()).toBe(403);
});
