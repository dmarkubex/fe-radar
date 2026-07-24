import {
  authenticate,
  credentialsFor,
  expect,
  test,
  type Page
} from "./fixtures";

test.describe.configure({ mode: "serial" });

// ---------------------------------------------------------------------------
// Cleanup: soft-delete all E2E test briefing targets after the serial suite
// finishes.  Uses the same DELETE endpoint the admin UI calls (soft-delete /
// disabled_at stamp).
// ---------------------------------------------------------------------------
test.afterAll(async ({ request }) => {
  const admin = credentialsFor("admin");
  if (!admin) return;
  await authenticate(request, admin, "/admin/briefing/targets");

  const listRes = await request.get("/api/briefing/targets");
  if (!listRes.ok()) return;
  const { items } = await listRes.json() as { items: Array<{ id: number; name: string }> };
  const e2eTargets = items.filter((t) => t.name.startsWith("E2E "));
  await Promise.all(
    e2eTargets.map((t) => request.delete(`/api/briefing/targets/${t.id}`))
  );
});

async function createTargetViaApi(
  page: Page,
  name: string
): Promise<{ id: number; webhookUrl: string }> {
  const webhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=e2e_${encodeURIComponent(name)}`;
  const response = await page.request.post("/api/briefing/targets", {
    data: {
      name,
      channel: "dingtalk_bot",
      webhookUrl,
      signSecret: null,
      enabled: true
    }
  });
  expect(response.status()).toBe(201);
  return await response.json() as { id: number; webhookUrl: string };
}

test("未登录访问 admin briefing/targets 会跳转登录页", async ({ page }) => {
  await page.goto("/admin/briefing/targets");
  await expect(page).toHaveURL(/\/auth\/login/);
});

test("admin 可以登录并进入 briefing targets 后台", async ({ page, login }) => {
  await login("admin", "/admin/briefing/targets");
  await page.goto("/admin/briefing/targets");
  await expect(page.getByRole("heading", { name: "推送目标列表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新增推送目标" })).toBeVisible();
});

test("admin 可以通过 UI 新建推送目标", async ({ page, login }) => {
  const name = `E2E 新建 ${Date.now()}`;
  const webhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=e2e_${Date.now()}`;
  const signSecret = "E2ESECRET";

  await login("admin", "/admin/briefing/targets");
  await page.goto("/admin/briefing/targets");

  // Open the add-form via the "新建推送目标" button in the right panel
  await page.getByRole("button", { name: "新建推送目标" }).click();

  await page.getByPlaceholder("推送目标名称").fill(name);
  await page.getByPlaceholder("https://oapi.dingtalk.com/robot/send?access_token=...").fill(webhookUrl);
  await page.locator("input[name='signSecret']").fill(signSecret);

  await page.getByRole("button", { name: "新建" }).click();

  // Wait for the table to reflect the newly created row
  await page.waitForFunction(
    (n) => Array.from(document.querySelectorAll("tbody td")).some((td) => td.textContent === n),
    name
  );

  await expect(page.getByRole("cell", { name })).toBeVisible();
});

test("admin 可以编辑推送目标名称", async ({ page, login }) => {
  const updatedName = `E2E 已编辑 ${Date.now()}`;
  await login("admin", "/admin/briefing/targets");
  const originalName = `E2E 编辑 ${Date.now()}`;
  await createTargetViaApi(page, originalName);
  await page.goto("/admin/briefing/targets");

  const row = page.getByRole("row", { name: new RegExp(originalName) });
  await row.getByRole("button", { name: "编辑" }).click();

  // Edit modal opens — the form uses placeholder="推送目标名称" for the name field
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("推送目标名称").fill(updatedName);
  await dialog.getByRole("button", { name: "保存修改" }).click();

  await expect(page.getByRole("cell", { name: updatedName })).toBeVisible();
});

test("sign_secret 字段类型为 password 且 API 响应中掩码为 ***", async ({ page, login }) => {
  const name = `E2E 密钥掩码 ${Date.now()}`;
  const webhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=e2e_mask_${Date.now()}`;

  await login("admin", "/admin/briefing/targets");
  await page.goto("/admin/briefing/targets");

  // Open the add-form
  await page.getByRole("button", { name: "新建推送目标" }).click();

  // Verify signSecret input is type=password
  const secretInput = page.locator("input[name='signSecret']");
  await expect(secretInput).toHaveAttribute("type", "password");

  // Create a target with a signSecret via API and verify the list response masks it
  const createRes = await page.request.post("/api/briefing/targets", {
    data: {
      name,
      channel: "dingtalk_bot",
      webhookUrl,
      signSecret: "supersecret",
      enabled: true
    }
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json() as { id: number; signSecret: string | null };

  // POST /api/briefing/targets response must mask the secret
  expect(created.signSecret).toBe("***");

  // GET /api/briefing/targets list response must also mask it
  const listRes = await page.request.get("/api/briefing/targets");
  expect(listRes.ok()).toBe(true);
  const { items } = await listRes.json() as { items: Array<{ id: number; signSecret: string | null }> };
  const found = items.find((i) => i.id === created.id);
  expect(found).toBeDefined();
  expect(found?.signSecret).toBe("***");

  // Cleanup this target immediately
  await page.request.delete(`/api/briefing/targets/${created.id}`);
});

test("admin 删除推送目标需软确认（输入名称）", async ({ page, login }) => {
  await login("admin", "/admin/briefing/targets");
  const targetName = `E2E 删除 ${Date.now()}`;
  const target = await createTargetViaApi(page, targetName);
  await page.goto("/admin/briefing/targets");

  const row = page.getByRole("row", { name: new RegExp(targetName) });
  await row.getByRole("button", { name: "删除" }).click();

  // Dialog appears
  const dialog = page.getByRole("dialog", { name: "确认删除推送目标" });
  await expect(dialog).toBeVisible();

  // Confirm button is disabled until name matches
  const confirmBtn = dialog.getByRole("button", { name: "确认删除" });
  await expect(confirmBtn).toBeDisabled();

  // Fill in the target name to enable the confirm button
  const confirmInput = dialog.getByLabel("输入目标名称确认删除");
  await confirmInput.fill(targetName);

  await expect(confirmBtn).toBeEnabled();
  await confirmBtn.click();

  // Modal closes and the row disappears (soft-delete removes from active list)
  await expect(dialog).not.toBeVisible();
  await expect(row).not.toBeVisible();

  // Verify the API no longer returns this target in the active list
  const afterRes = await page.request.get("/api/briefing/targets");
  const after = await afterRes.json() as { items: Array<{ id: number }> };
  expect(after.items.find((i) => i.id === target.id)).toBeUndefined();
});

test("测试推送按钮触发 POST .../test 并显示 toast", async ({ page, login }) => {
  await login("admin", "/admin/briefing/targets");
  const targetName = `E2E 测试推送 ${Date.now()}`;
  const target = await createTargetViaApi(page, targetName);
  await page.goto("/admin/briefing/targets");

  const row = page.getByRole("row", { name: new RegExp(targetName) });

  // Intercept the POST .../test request so we control the response
  await page.route(`/api/briefing/targets/${target.id}/test`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await row.getByRole("button", { name: "测试推送" }).click();

  // A toast with role="status" should appear (success path)
  const toast = page.locator('[role="status"]').filter({ hasText: "测试推送成功" });
  await expect(toast).toBeVisible();
});

test("viewer 访问 admin briefing/targets 返回 403", async ({ page, login }) => {
  await login("viewer", "/admin/briefing/targets");
  const response = await page.goto("/admin/briefing/targets");
  expect(response?.status()).toBe(403);
});
