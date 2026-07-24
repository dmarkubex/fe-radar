import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { expect, test, type Page } from "./fixtures";

const target = {
  id: 7101,
  name: "E2E 推送目标",
  channel: "dingtalk_bot",
  webhookUrl: "https://oapi.dingtalk.com/robot/send?access_token=e2e",
  signSecret: "***",
  enabled: true,
  createdAt: null
};
const source = {
  id: 7201,
  name: "E2E 稳定信源",
  url: "https://example.com/e2e-stable-source",
  urlLocked: false,
  fetcherType: "rss",
  config: { type: "rss", url: "https://example.com/e2e-stable-source" },
  tier: "T1",
  category: "E2E",
  enabled: true,
  lastOkAt: null,
  failCount: 0
};

test("Dialog: Esc, Tab trap, focus restore and body scroll lock", async ({ page, login }) => {
  await login("admin", "/admin/briefing/targets");
  await mockTargets(page);
  await page.goto("/admin/briefing/targets");

  const row = page.getByRole("row", { name: /E2E 推送目标/ });
  const trigger = row.getByRole("button", { name: "编辑" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /编辑推送目标/ });
  const first = dialog.getByPlaceholder("推送目标名称");
  const last = dialog.getByRole("button", { name: "取消" });
  await expect(first).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
});

test("RBAC: viewer/editor/admin navigation and direct admin routes", async ({ page, login }) => {
  await login("viewer");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "全文搜索" })).toBeVisible();
  await expect(page.getByRole("link", { name: "信源 Sources" })).toHaveCount(0);
  expect((await page.goto("/admin/sources"))?.status()).toBe(403);

  await login("editor");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "实体库" })).toBeVisible();
  await expect(page.getByRole("link", { name: "信源 Sources" })).toBeVisible();
  await expect(page.getByRole("link", { name: "用户与权限" })).toHaveCount(0);
  expect((await page.goto("/admin/entities"))?.status()).toBe(200);
  expect((await page.goto("/admin/sources"))?.status()).toBe(200);
  expect((await page.goto("/admin/users"))?.status()).toBe(403);

  await login("admin");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "用户与权限" })).toBeVisible();
  expect((await page.goto("/admin/users"))?.status()).toBe(200);
});

test("SF-01 dismiss 500 is visible and alert stays", async ({ page, login }) => {
  await login("admin", "/alerts");
  const fixture = await itemFixtureOrMock();
  try {
    await page.route("**/api/alerts/dismiss", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "E2E 忽略失败" } })
      })
    );
    await page.goto("/alerts?range=all");
    const title = page.getByText(fixture.title, { exact: true });
    await expect(title).toBeVisible();
    await title.locator("xpath=ancestor::article").getByRole("button", { name: "忽略" }).click();
    const dialog = page.getByRole("dialog", { name: "确认忽略告警" });
    await dialog.getByRole("button", { name: "确认忽略" }).click();
    await expect(dialog.getByRole("alert")).toContainText("E2E 忽略失败");
    await expect(title).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("SF-02 download fetch reject is visible", async ({ page, login }) => {
  await login("admin", "/briefing");
  const fixture = await briefingFixture();
  try {
    await page.route(`**/api/briefing/${fixture.id}/download`, (route) =>
      route.abort("failed")
    );
    await page.goto(`/briefing/${fixture.id}`);
    await page.getByRole("button", { name: "下载 docx" }).click();
    await expect(
      page.getByText("下载失败，请检查网络后重试", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "下载 docx" })).toBeVisible();
  } finally {
    await fixture.cleanup();
  }
});

test("SF-03 delete 500 and SF-14 create reject stay visible", async ({ page, login }) => {
  await login("admin", "/admin/entities");
  await page.route("**/api/entities**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [{
            id: 7301,
            type: "company",
            canonicalName: "E2E 实体",
            aliases: [],
            circle: "C1",
            weight: 1
          }]
        })
      });
    } else if (request.method() === "POST") {
      await route.abort("failed");
    } else {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "E2E 删除实体失败" } })
      });
    }
  });
  await page.goto("/admin/entities");

  await page.getByPlaceholder("标准名").fill("E2E 新实体");
  await page.getByRole("button", { name: "新增实体" }).click();
  await expect(page.getByText("保存失败，请检查网络后重试", { exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: /E2E 实体/ });
  await row.getByRole("button", { name: "删除" }).click();
  const dialog = page.getByRole("dialog", { name: "确认删除实体" });
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("E2E 删除实体失败");
  await expect(dialog).toBeVisible();
});

test("SF-04 user update 500, SF-12 create reject, SF-13 conflict reject", async ({ page, login }) => {
  const fixture = await usersFixture();
  await login("admin", "/admin/users");
  try {
    await page.route("**/api/users**", async (route) => {
      const method = route.request().method();
      const pathname = new URL(route.request().url()).pathname;
      if (method === "POST" && pathname === "/api/users") {
        await route.abort("failed");
      } else if (method === "POST") {
        await route.abort("failed");
      } else {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { message: "E2E 用户保存失败" } })
        });
      }
    });
    await page.goto("/admin/users");

    const userRow = page.getByRole("row", { name: new RegExp(fixture.viewerName) });
    await userRow.getByRole("combobox").selectOption("editor");
    await expect(userRow.getByRole("alert")).toContainText("E2E 用户保存失败");

    await page.getByPlaceholder("用户名").fill(`e2e-${randomUUID().slice(0, 8)}`);
    await page.getByPlaceholder("密码", { exact: true }).fill("E2e-password");
    await page.getByPlaceholder("确认密码").fill("E2e-password");
    await page.getByPlaceholder("姓名", { exact: true }).fill("E2E 用户");
    await page.getByRole("button", { name: "新增用户" }).click();
    await expect(page.getByText("创建失败：请检查网络后重试", { exact: true })).toBeVisible();

    const conflict = page.getByText("E2E 合并冲突", { exact: false }).locator("..");
    await conflict.getByRole("button", { name: "拒绝" }).click();
    await expect(conflict.getByRole("alert")).toContainText("处理失败，请检查网络后重试");
  } finally {
    await fixture.cleanup();
  }
});

test("SF-05 proxy re-enable fetch reject is visible", async ({ page, login }) => {
  const proxyList = process.env.PROXY_LIST_FILE ?? "/tmp/fe-radar-e2e-proxies.txt";
  const disabledFile =
    process.env.PROXY_DISABLED_FILE ?? "/tmp/fe-radar-e2e-disabled-proxies.json";
  await login("admin", "/admin/dashboard");
  let originalProxyList: Buffer | null | undefined;
  let originalDisabledFile: Buffer | null | undefined;
  try {
    originalProxyList = await readFileIfExists(proxyList);
    originalDisabledFile = await readFileIfExists(disabledFile);
    await writeFile(proxyList, "http://127.0.0.1:8899\n");
    await writeFile(disabledFile, JSON.stringify({
      "proxy-1": {
        reason: "E2E health failure",
        disabledAt: new Date().toISOString(),
        failCount: 7
      }
    }));
    await page.route("**/api/admin/proxy/proxy-1/re-enable", (route) =>
      route.abort("failed")
    );
    await page.goto("/admin/dashboard");
    const row = page.getByRole("row", { name: /127\.0\.0\.1:8899/ });
    await row.getByRole("button", { name: "重启" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "代理重启失败，请检查网络后重试" })
    ).toBeVisible();
    await expect(row).toBeVisible();
  } finally {
    await Promise.all([
      restoreFile(proxyList, originalProxyList),
      restoreFile(disabledFile, originalDisabledFile)
    ]);
  }
});

test("SF-06 source toggle 500 and SF-07 delete reject are visible", async ({ page, login }) => {
  await login("admin", "/admin/sources");
  await page.route("**/api/admin/source-health", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        summary: { healthy: 1, stale: 0, failing: 0, disabled: 0, fetched24h: 0 },
        sources: []
      })
    })
  );
  await page.route("**/api/sources**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/sources") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ items: [source] })
      });
    } else if (request.method() === "PUT") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "E2E 更新信源状态失败" } })
      });
    } else {
      await route.abort("failed");
    }
  });
  await page.goto("/admin/sources");
  const row = page.getByRole("row", { name: /E2E 稳定信源/ });

  await row.getByRole("button", { name: "停用" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "E2E 更新信源状态失败" })
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "停用" })).toBeVisible();

  await row.getByRole("button", { name: "删除" }).click();
  const dialog = page.getByRole("dialog", { name: "确认删除信源" });
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog.getByRole("alert")).toContainText("删除信源失败，请检查网络后重试");
  await expect(dialog).toBeVisible();
});

test("SF-08 target toggle 500 and SF-09 delete 500 are visible", async ({ page, login }) => {
  await login("admin", "/admin/briefing/targets");
  await mockTargets(page);
  await page.route("**/api/briefing/targets/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 500, body: "{}" });
    } else {
      await route.fulfill({ status: 500, body: "{}" });
    }
  });
  await page.goto("/admin/briefing/targets");
  const row = page.getByRole("row", { name: /E2E 推送目标/ });

  await row.getByRole("button", { name: "停用" }).click();
  await expect(page.getByRole("status").filter({ hasText: "更新状态失败" })).toBeVisible();
  await expect(row.getByRole("button", { name: "停用" })).toBeVisible();

  await row.getByRole("button", { name: "删除" }).click();
  const dialog = page.getByRole("dialog", { name: "确认删除推送目标" });
  await dialog.getByLabel("输入目标名称确认删除").fill(target.name);
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByRole("status").filter({ hasText: "删除失败" })).toBeVisible();
  await expect(dialog).toBeVisible();
});

test("SF-10 scoring save 500 message is visible", async ({ page, login }) => {
  await login("admin", "/admin/scoring-config");
  await page.route("**/api/scoring-config", (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "E2E 配置拒绝" } })
      });
    }
    return route.continue();
  });
  await page.goto("/admin/scoring-config");
  await page
    .getByText("T1", { exact: true })
    .locator("..")
    .getByRole("spinbutton")
    .fill("1.1");
  await page.getByRole("button", { name: "保存配置" }).click();
  await expect(page.getByText("保存失败：E2E 配置拒绝", { exact: true })).toBeVisible();
});

test("SF-11 feedback fetch reject rolls back and shows failure", async ({ page, login }) => {
  await login("admin");
  const fixture = await itemFixtureOrMock();
  let releaseRequest = (): void => undefined;
  try {
    let requestCount = 0;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route(`**/api/items/${fixture.id}/feedback`, async (route) => {
      requestCount += 1;
      await requestGate;
      await route.abort("failed");
    });
    await page.goto(`/items/${fixture.id}`);
    const button = page.getByRole("button", { name: "有价值" });
    await button.click();
    await expect.poll(() => requestCount).toBe(1);
    const voteButtons = [
      button,
      page.getByRole("button", { name: "不准确" }),
      page.getByRole("button", { name: "清除" })
    ];
    for (const voteButton of voteButtons) {
      await expect(voteButton).toBeDisabled();
    }
    await voteButtons[1]!.evaluate((element) => (element as HTMLButtonElement).click());
    expect(requestCount).toBe(1);
    releaseRequest();
    await expect(page.getByRole("alert").filter({ hasText: "提交失败" })).toBeVisible();
    await expect(button).toHaveClass(/border-border/);
  } finally {
    releaseRequest();
    await fixture.cleanup();
  }
});

async function readFileIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function restoreFile(path: string, contents: Buffer | null | undefined): Promise<void> {
  if (contents === undefined) return;
  if (contents !== null) {
    await writeFile(path, contents);
    return;
  }
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function mockTargets(page: Page): Promise<void> {
  await page.route("**/api/briefing/targets", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [target] })
    })
  );
}

async function database() {
  if (!process.env.DATABASE_URL) {
    test.skip(true, "requires DATABASE_URL and migrated E2E Postgres");
  }
  const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false });
  try {
    await db`select 1`;
  } catch {
    await db.end();
    test.skip(true, "requires migrated E2E Postgres from .github/workflows/e2e.yml");
  }
  return db;
}

async function itemFixtureOrMock(): Promise<{
  id: number;
  title: string;
  cleanup(): Promise<void>;
}> {
  if (process.env.APP_DATA_MODE === "mock") {
    return {
      id: 30,
      title: "远东智慧能源中标国网江苏电缆框架采购，标包金额待披露",
      cleanup: async () => undefined
    };
  }
  const db = await database();
  const marker = randomUUID();
  const sourceUrl = `https://example.com/e2e/${marker}`;
  const [sourceRow] = await db<{ id: number }[]>`
    insert into sources (name, url, fetcher_type, config, tier, category)
    values (
      ${`E2E ${marker}`},
      ${sourceUrl},
      'rss',
      ${JSON.stringify({ type: "rss", url: sourceUrl })}::jsonb,
      'T1',
      'E2E'
    )
    returning id
  `;
  const title = `E2E 告警 ${marker}`;
  const [item] = await db<{ id: number }[]>`
    insert into items (source_id, url, title, content, lang, published_at)
    values (
      ${sourceRow!.id},
      ${`https://example.com/e2e/item/${marker}`},
      ${title},
      'E2E',
      'zh',
      now()
    )
    returning id
  `;
  await db`
    insert into item_analysis (
      item_id, is_industry_related, summary_zh, quality_score, category,
      top_circle, alert_level, alert_type, quota_state, scored_at
    )
    values (
      ${item!.id}, true, 'E2E', 80, '公司与资本',
      'C1', 'L1', 'risk', 'admitted', now()
    )
  `;
  return {
    id: item!.id,
    title,
    cleanup: async () => {
      await db`delete from items where id = ${item!.id}`;
      await db`delete from sources where id = ${sourceRow!.id}`;
      await db.end();
    }
  };
}

async function briefingFixture(): Promise<{ id: number; cleanup(): Promise<void> }> {
  const db = await database();
  const seed = Number.parseInt(randomUUID().slice(0, 4), 16);
  const date = `2099-${String((seed % 12) + 1).padStart(2, "0")}-${String((seed % 28) + 1).padStart(2, "0")}`;
  const [row] = await db<{ id: number }[]>`
    insert into commodity_briefings (
      briefing_date, template_version, payload_json, docx_path, gen_status
    )
    values (
      ${date}, 1, '{}'::jsonb, ${`e2e/${randomUUID()}.docx`}, 'succeeded'
    )
    returning id
  `;
  return {
    id: row!.id,
    cleanup: async () => {
      await db`delete from commodity_briefings where id = ${row!.id}`;
      await db.end();
    }
  };
}

async function usersFixture(): Promise<{
  viewerName: string;
  cleanup(): Promise<void>;
}> {
  const db = await database();
  const [viewer] = await db<{ id: number; name: string }[]>`
    select id, name from users where role = 'viewer' limit 1
  `;
  if (!viewer) {
    await db.end();
    test.skip(true, "requires seed:admin viewer account");
    throw new Error("viewer seed missing");
  }
  const [conflict] = await db<{ id: number }[]>`
    insert into merge_conflicts (unionid, name, dept, candidate_ids, status)
    values (
      ${`e2e-${randomUUID()}`},
      'E2E 合并冲突',
      'E2E',
      ARRAY[${viewer.id}::bigint],
      'pending'
    )
    returning id
  `;
  return {
    viewerName: viewer.name,
    cleanup: async () => {
      await db`delete from merge_conflicts where id = ${conflict!.id}`;
      await db.end();
    }
  };
}
