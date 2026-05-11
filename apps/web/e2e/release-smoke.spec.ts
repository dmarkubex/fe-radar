import { expect, test, type Page } from "@playwright/test";

const adminUsername = process.env.E2E_ADMIN_USERNAME ?? "admin";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin-password";

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
}

test.describe("release smoke", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("timeline loads", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "时间线" })).toBeVisible();
  });

  test("curated loads", async ({ page }) => {
    await page.goto("/curated");
    await expect(page.getByRole("heading", { name: "精选" })).toBeVisible();
  });

  test("search loads", async ({ page }) => {
    await page.goto("/search?q=远东");
    await expect(page.getByRole("heading", { name: "搜索" })).toBeVisible();
  });

  test("alerts loads", async ({ page }) => {
    await page.goto("/alerts?type=safety");
    await expect(page.getByRole("heading", { name: "告警" })).toBeVisible();
  });

  test("daily loads", async ({ page }) => {
    await page.goto("/daily");
    await expect(page.getByRole("heading", { name: "日报" })).toBeVisible();
  });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page.getByRole("heading", { name: "运行仪表盘" })).toBeVisible();
  });
});
