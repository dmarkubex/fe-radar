import {
  authenticate,
  credentialsFor,
  expect,
  test,
  type Page
} from "./fixtures";

const SOURCE_NAME_PREFIX = "E2E Sources ";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Cleanup: soft-delete all E2E test entities after the serial suite finishes.
// Prevents accumulation of enabled T1 rows across reruns.  Uses the same
// DELETE endpoint the admin UI calls (soft-delete / set enabled=false).
// ---------------------------------------------------------------------------
test.afterAll(async ({ request }) => {
  const admin = credentialsFor("admin");
  if (!admin) return;
  await authenticate(request, admin, "/admin/sources");

  const listRes = await request.get("/api/sources");
  if (!listRes.ok()) return;
  const { items } = await listRes.json() as { items: Array<{ id: number; name: string }> };
  const e2eSources = items.filter((s) => s.name.startsWith(SOURCE_NAME_PREFIX));
  await Promise.all(
    e2eSources.map((s) => request.delete(`/api/sources/${s.id}`))
  );
});

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

test("admin 可以登录并进入 sources 后台", async ({ page, login }) => {
  await login("admin", "/admin/sources");
  await page.goto("/admin/sources");
  await expect(page.getByRole("heading", { name: "信源管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新增信源" })).toBeVisible();
});

test("admin 页面按 tier 稳定渲染一次 API 快照及启用数", async ({ page, login }) => {
  await login("admin", "/admin/sources");

  // Fetch expected counts from API to derive per-tier expectations dynamically
  const apiRes = await page.request.get("/api/sources");
  expect(apiRes.ok()).toBe(true);
  const { items } = await apiRes.json() as { items: Array<{ enabled: boolean; tier: string }> };

  // Compute per-tier counts from the API (only T1/T2/T3 tiers)
  const totalByTier: Record<"T1" | "T2" | "T3", number> = { T1: 0, T2: 0, T3: 0 };
  const enabledByTier: Record<"T1" | "T2" | "T3", number> = { T1: 0, T2: 0, T3: 0 };
  for (const s of items) {
    if (s.tier === "T1" || s.tier === "T2" || s.tier === "T3") {
      totalByTier[s.tier]++;
      if (s.enabled) enabledByTier[s.tier]++;
    }
  }
  const totalSources = totalByTier.T1 + totalByTier.T2 + totalByTier.T3;
  const totalEnabled = enabledByTier.T1 + enabledByTier.T2 + enabledByTier.T3;

  // Keep this count contract deterministic while other CRUD specs mutate the
  // same E2E database in parallel.
  await page.route(/\/api\/sources(?:\?.*)?$/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items })
    })
  );
  await page.goto("/admin/sources");
  // Wait for the source table to finish loading rows from the API.
  // On "全部" view, the row count should equal the API total (or at least be substantial).
  await page.waitForFunction(
    (min) => document.querySelectorAll("tbody tr[data-testid]").length >= min,
    Math.max(totalSources - 5, 5)
  );

  // Verify per-tier total row counts match API.
  // Only count rows with data-testid (real source rows), excluding the
  // "暂无匹配信源" placeholder row that appears for empty tiers.
  for (const tier of ["T1", "T2", "T3"] as const) {
    await page.getByRole("button", { name: tier }).click();
    const rows = await page.locator("tbody tr[data-testid]").count();
    expect(rows, `${tier} total`).toBe(totalByTier[tier]);
  }

  // Verify enabled source count: switch to ALL view and count rows with "启用" status
  await page.getByRole("button", { name: "全部" }).click();
  const statusCells = page.locator("tbody tr[data-testid] td:nth-child(5)");
  const enabledCount = await statusCells.filter({ hasText: "启用" }).count();
  expect(enabledCount, "Enabled sources").toBe(totalEnabled);
});

test("admin 可以通过 UI 新建信源", async ({ page, login }) => {
  const name = `${SOURCE_NAME_PREFIX}新建 ${Date.now()}`;
  const url = `https://example.com/${encodeURIComponent(name)}`;
  await login("admin", "/admin/sources");
  await page.goto("/admin/sources");

  await page.getByPlaceholder("信源名称", { exact: true }).fill(name);
  await page.locator("input[name='url']").fill(url);
  await page.locator("select[name='tier']").selectOption("T1");
  await page.locator("select[name='fetcherType']").selectOption("rss");
  await page.getByPlaceholder("分类").fill("E2E");
  await page.locator("textarea").fill(JSON.stringify({ type: "rss", url }, null, 2));
  await page.getByRole("button", { name: "新建" }).click();

  await page.getByRole("button", { name: "T1" }).click();
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
});

test("admin 可以编辑信源名称", async ({ page, login }) => {
  const sourceName = `${SOURCE_NAME_PREFIX}编辑 ${Date.now()}`;
  const updatedName = `${SOURCE_NAME_PREFIX}已编辑 ${Date.now()}`;
  await login("admin", "/admin/sources");
  await createSourceViaApi(page, sourceName);
  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  const row = page.getByRole("row", { name: new RegExp(sourceName) });
  await row.getByRole("button", { name: "编辑" }).click();
  await page.getByPlaceholder("信源名称", { exact: true }).fill(updatedName);
  await page.getByRole("button", { name: "保存修改" }).click();

  await expect(page.getByRole("row", { name: new RegExp(updatedName) })).toBeVisible();
});

test("admin 删除信源时执行软删", async ({ page, login }) => {
  await login("admin", "/admin/sources");
  const sourceName = `${SOURCE_NAME_PREFIX}删除 ${Date.now()}`;
  const source = await createSourceViaApi(page, sourceName);
  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  const row = page.getByRole("row", { name: new RegExp(sourceName) });
  await row.getByRole("button", { name: "删除" }).click();
  const dialog = page.getByRole("dialog", { name: "确认删除信源" });
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText("停用");

  const listResponse = await page.request.get("/api/sources?tier=T1");
  expect(listResponse.ok()).toBe(true);
  const payload = await listResponse.json() as { items: Array<{ id: number; enabled: boolean }> };
  expect(payload.items.find((item) => item.id === source.id)?.enabled).toBe(false);
});

test("viewer 访问 admin sources 返回 403", async ({ page, login }) => {
  await login("viewer", "/admin/sources");
  const response = await page.goto("/admin/sources");
  expect(response?.status()).toBe(403);
});
