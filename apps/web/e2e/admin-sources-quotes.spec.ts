import { expect, test, type Page } from "@playwright/test";

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin-password";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Cleanup: soft-delete all E2E test entities after the serial suite finishes.
// Mirrors the afterAll pattern in admin-sources.spec.ts exactly.
// ---------------------------------------------------------------------------
test.afterAll(async ({ request }) => {
  const csrfRes = await request.get("/api/auth/csrf");
  if (!csrfRes.ok()) return;
  const csrf = await csrfRes.json() as { csrfToken: string };
  await request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken: csrf.csrfToken,
      username: adminUsername,
      password: adminPassword,
      callbackUrl: "/admin/sources"
    },
    maxRedirects: 0
  });

  const listRes = await request.get("/api/sources");
  if (!listRes.ok()) return;
  const { items } = await listRes.json() as { items: Array<{ id: number; name: string }> };
  const e2eSources = items.filter((s) => s.name.startsWith("E2E "));
  await Promise.all(
    e2eSources.map((s) => request.delete(`/api/sources/${s.id}`))
  );
});

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

async function createQuotesSourceViaApi(
  page: Page,
  name: string
): Promise<{ id: number; url: string }> {
  const url = `https://example.com/${encodeURIComponent(name)}`;
  const response = await page.request.post("/api/sources", {
    data: {
      name,
      url,
      tier: "T1",
      fetcherType: "quotes",
      category: "E2E",
      config: {
        type: "quotes",
        adapter: "shfe",
        metric_keys: ["cu_main_close"],
        endpoint: "http://www.shfe.com.cn/data/dailydata/kx/kx{YYYYMMDD}.dat",
        retry: { max: 3, backoffMs: 2000 }
      }
    }
  });
  expect(response.status()).toBe(201);
  return await response.json() as { id: number; url: string };
}

test("admin 登录后进入 sources 页面显示预期标题", async ({ page }) => {
  await login(page, adminUsername, adminPassword);
  await page.goto("/admin/sources");
  await expect(page.getByRole("heading", { name: "信源管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新增信源" })).toBeVisible();
});

test("admin 可通过 UI 新建 quotes 类型信源并在 T1 列表中看到", async ({ page }) => {
  const name = `E2E Quotes UI ${Date.now()}`;
  const url = `https://example.com/${encodeURIComponent(name)}`;

  await login(page, adminUsername, adminPassword);
  await page.goto("/admin/sources");

  // Fill basic fields
  await page.getByPlaceholder("信源名称").fill(name);
  await page.locator("input[name='url']").fill(url);
  await page.locator("select[name='tier']").selectOption("T1");

  // Select quotes fetcher type — this reveals the quotes-specific UI block
  await page.locator("select[name='fetcherType']").selectOption("quotes");

  // Fill the quotes-specific adapter and metric_keys fields
  await page.locator("[data-testid='adapter-select']").selectOption("shfe");
  await page.locator("[data-testid='metric-keys-input']").fill("cu_main_close");

  await page.getByPlaceholder("分类").fill("E2E");

  await page.getByRole("button", { name: "新建" }).click();

  // Switch to T1 filter and wait for the new row to appear
  await page.getByRole("button", { name: "T1" }).click();
  await page.waitForFunction(
    (rowName: string) =>
      Array.from(document.querySelectorAll("tbody tr[data-testid]")).some(
        (row) => row.textContent?.includes(rowName)
      ),
    name
  );
  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
});

test("admin 可通过 API 新建 quotes 信源并在列表中看到", async ({ page }) => {
  const name = `E2E Quotes API ${Date.now()}`;

  await login(page, adminUsername, adminPassword);
  const source = await createQuotesSourceViaApi(page, name);

  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  await page.waitForFunction(
    (min) => document.querySelectorAll("tbody tr[data-testid]").length >= min,
    1
  );

  await expect(page.getByRole("row", { name: new RegExp(name) })).toBeVisible();

  // Confirm API response has expected shape
  const listRes = await page.request.get("/api/sources?tier=T1");
  expect(listRes.ok()).toBe(true);
  const { items } = await listRes.json() as { items: Array<{ id: number; name: string; fetcherType: string }> };
  const created = items.find((s) => s.id === source.id);
  expect(created).toBeDefined();
  expect(created?.fetcherType).toBe("quotes");
});

test("admin 软删除 quotes 信源后 enabled 变为 false", async ({ page }) => {
  const name = `E2E Quotes Delete ${Date.now()}`;

  await login(page, adminUsername, adminPassword);
  const source = await createQuotesSourceViaApi(page, name);

  await page.goto("/admin/sources");
  await page.getByRole("button", { name: "T1" }).click();

  await page.waitForFunction(
    (rowName: string) =>
      Array.from(document.querySelectorAll("tbody tr[data-testid]")).some(
        (row) => row.textContent?.includes(rowName)
      ),
    name
  );

  const row = page.getByTestId(`source-row-${source.id}`);
  await row.getByRole("button", { name: "删除" }).click();
  await expect(row).toContainText("停用");

  // Confirm via API that enabled=false
  const listRes = await page.request.get("/api/sources?tier=T1");
  expect(listRes.ok()).toBe(true);
  const payload = await listRes.json() as { items: Array<{ id: number; enabled: boolean }> };
  expect(payload.items.find((item) => item.id === source.id)?.enabled).toBe(false);
});
