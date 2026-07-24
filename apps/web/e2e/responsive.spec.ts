import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";

const ROUTES = [
  "/",
  "/curated",
  "/daily",
  "/alerts",
  "/items",
  "/items/:id",
  "/briefing",
  "/briefing/:id",
  "/search",
  "/admin/dashboard",
  "/admin/sources",
  "/admin/entities",
  "/admin/scoring-config",
  "/admin/users",
  "/admin/worker",
  "/admin/backlog",
  "/admin/briefing/targets",
  "/auth/login"
] as const;

test.beforeEach(async ({ login }) => {
  await login("admin");
});

test("18 routes keep one main landmark and no horizontal overflow", async ({ page }) => {
  test.setTimeout(120_000);
  const item = await itemFixture();
  try {
    const briefing = await briefingFixture();
    try {
      const routes = ROUTES.map((route) =>
        route === "/items/:id"
          ? `/items/${item.id}`
          : route === "/briefing/:id"
            ? `/briefing/${briefing.id}`
            : route
      );
      for (const route of routes) {
        const response = await page.goto(route);
        await page.waitForLoadState("domcontentloaded");
        expect.soft(response?.ok(), `${route}: successful response`).toBe(true);
        await expect.soft(page.locator("main"), `${route}: main`).toHaveCount(1);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect.soft(overflow, `${route}: horizontal overflow px`).toBeLessThanOrEqual(1);
        if (route === "/curated" && (page.viewportSize()?.width ?? 0) < 760) {
          const category = page.getByLabel("精选分类").getByRole("button").first();
          const box = await category.boundingBox();
          expect.soft(box, "curated category touch target").not.toBeNull();
          expect.soft(box?.height ?? 0, "curated category touch height").toBeGreaterThanOrEqual(44);
          expect.soft(box?.width ?? 0, "curated category touch width").toBeGreaterThanOrEqual(44);
        }
        if (route === `/items/${item.id}`) {
          await expect(page.getByRole("heading", { level: 1, name: item.title })).toBeVisible();
        } else if (route === `/briefing/${briefing.id}`) {
          await expect(
            page.getByRole("heading", { level: 1, name: "远东·铜锂行情简报" })
          ).toBeVisible();
          await expect(page.getByText(`简报 · ${briefing.date}`, { exact: true })).toBeVisible();
        } else if (route === "/") {
          await assertMobileTimelineDateBar(page);
        } else if (route === "/alerts") {
          await assertAlertsBreakpoint(page);
        } else if (route === "/auth/login") {
          await assertLoginBreakpoints(page);
        }
      }
    } finally {
      await briefing.cleanup();
    }
  } finally {
    await item.cleanup();
  }
});

for (const total of [0, 5] as const) {
  test(`sticky headers do not overlap when AlertBadge=${total}`, async ({ page }) => {
    await page.route("**/api/alerts/count", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          own: total > 0 ? 1 : 0,
          safety: total > 0 ? 1 : 0,
          policy: total > 0 ? 1 : 0,
          legal: total > 0 ? 1 : 0,
          risk: total > 0 ? 1 : 0
        })
      })
    );
    await page.goto("/daily");
    const main = page.locator("main");
    const shellHeader = main.locator(":scope > div").first();
    const statusBar = shellHeader.locator(":scope > div").last();
    const dateLink = page.getByRole("link", { name: /^\d+\/\d+$/ }).first();
    await expect(dateLink).toBeVisible();
    const dailyBar = dateLink.locator("../..");
    await dailyBar.locator("..").evaluate((element) => {
      (element as HTMLElement).style.minHeight = "2000px";
      window.scrollTo(0, 600);
    });
    await page.waitForFunction(() => window.scrollY > 0);

    const statusBox = await statusBar.boundingBox();
    const dailyBox = await dailyBar.boundingBox();
    expect(statusBox, "shell status bar").not.toBeNull();
    expect(dailyBox, "daily sticky bar").not.toBeNull();
    expect(dailyBox!.y, "daily sticky starts below shell header").toBeGreaterThanOrEqual(
      statusBox!.y + statusBox!.height
    );

    if (total === 0) {
      await expect(statusBar.getByText("5", { exact: true })).toHaveCount(0);
    } else {
      await expect(statusBar.getByText("5", { exact: true })).toBeVisible();
    }

    await assertShellMode(page);
  });
}

async function assertShellMode(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  const menuButton = page.getByRole("button", { name: "打开菜单" });
  if (width < 760) {
    await expect(menuButton).toBeVisible();
    const menuBar = menuButton.locator("..");
    const menuBox = await menuBar.boundingBox();
    const statusBox = await menuBar.locator("..").locator(":scope > div").last().boundingBox();
    expect(menuBox, "mobile menu bar").not.toBeNull();
    expect(statusBox, "mobile status bar").not.toBeNull();
    expect(statusBox!.y, "mobile status follows menu").toBeGreaterThanOrEqual(
      menuBox!.y + menuBox!.height - 1
    );
  } else {
    await expect(menuButton).toBeHidden();
  }
}

async function assertMobileTimelineDateBar(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) >= 760) return;

  const main = page.locator("main");
  const shellHeader = main.locator(":scope > div").first();
  const statusBar = shellHeader.locator(":scope > div").last();
  const dateBar = page.locator('[role="heading"][aria-level="2"]').first();
  await expect(dateBar).toBeVisible();

  const originalTop = await dateBar.evaluate(
    (element) => element.getBoundingClientRect().top + window.scrollY
  );
  const statusBox = await statusBar.boundingBox();
  expect(statusBox, "mobile shell status bar").not.toBeNull();
  const headerBottom = statusBox!.y + statusBox!.height;
  await page.evaluate(
    ({ originalTop, headerBottom }) => {
      document.body.style.minHeight = "2000px";
      window.scrollTo(0, Math.max(0, originalTop - headerBottom + 20));
    },
    { originalTop, headerBottom }
  );
  await page.waitForFunction(() => window.scrollY > 0);

  const dateBox = await dateBar.boundingBox();
  const scrolledStatusBox = await statusBar.boundingBox();
  expect(dateBox, "timeline sticky date bar").not.toBeNull();
  expect(scrolledStatusBox, "mobile shell status bar after scroll").not.toBeNull();
  const scrolledHeaderBottom = scrolledStatusBox!.y + scrolledStatusBox!.height;
  expect(dateBox!.y, "timeline date bar stays below mobile shell").toBeGreaterThanOrEqual(
    scrolledHeaderBottom - 1
  );
  expect(dateBox!.y, "timeline date bar is actually sticky").toBeLessThanOrEqual(
    scrolledHeaderBottom + 2
  );
}

async function assertAlertsBreakpoint(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  if (width !== 1099 && width !== 1100) return;

  const header = page.getByRole("heading", { level: 1, name: /条告警/ }).locator("..");
  expect(
    await gridColumnCount(header),
    `${width}px alerts header semantic columns`
  ).toBe(width < 1100 ? 1 : 3);
}

async function assertLoginBreakpoints(page: Page): Promise<void> {
  const width = page.viewportSize()?.width ?? 0;
  if (width === 899 || width === 900) {
    const outerGrid = page.locator("main").locator("..");
    expect(
      await gridColumnCount(outerGrid),
      `${width}px login outer semantic columns`
    ).toBe(width < 900 ? 1 : 2);
  }
  if (width === 1179 || width === 1180) {
    const heroGrid = page
      .getByRole("heading", { level: 1, name: /行业信号先行/ })
      .locator(
        "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' grid ')][1]"
      );
    expect(
      await gridColumnCount(heroGrid),
      `${width}px login hero semantic columns`
    ).toBe(width < 1180 ? 1 : 2);
  }
}

async function gridColumnCount(locator: Locator): Promise<number> {
  return locator.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
  );
}

async function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("responsive E2E requires DATABASE_URL and migrated Postgres");
  }
  const db = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await db`select 1`;
  } catch (error) {
    await db.end();
    throw new Error("responsive E2E cannot reach migrated Postgres", { cause: error });
  }
  return db;
}

async function itemFixture(): Promise<{
  id: number;
  title: string;
  cleanup(): Promise<void>;
}> {
  const db = await database();
  const marker = randomUUID();
  const sourceUrl = `https://example.com/e2e-responsive/${marker}`;
  const [source] = await db<{ id: number }[]>`
    insert into sources (name, url, fetcher_type, config, tier, category)
    values (
      ${`E2E Responsive ${marker}`},
      ${sourceUrl},
      'rss',
      ${JSON.stringify({ type: "rss", url: sourceUrl })}::jsonb,
      'T1',
      'E2E'
    )
    returning id
  `;
  const title = `E2E 响应式详情 ${marker}`;
  const [item] = await db<{ id: number }[]>`
    insert into items (source_id, url, title, content, lang, published_at)
    values (
      ${source!.id},
      ${`https://example.com/e2e-responsive/item/${marker}`},
      ${title},
      'E2E responsive detail',
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
      ${item!.id}, true, 'E2E 响应式详情摘要', 80, '公司与资本',
      'C1', 'L1', 'risk', 'admitted', now()
    )
  `;
  return {
    id: item!.id,
    title,
    cleanup: async () => {
      try {
        await db`delete from items where id = ${item!.id}`;
        await db`delete from sources where id = ${source!.id}`;
      } finally {
        await db.end();
      }
    }
  };
}

async function briefingFixture(): Promise<{
  id: number;
  date: string;
  cleanup(): Promise<void>;
}> {
  const db = await database();
  const seed = randomUUID().replaceAll("-", "");
  const date = [
    2300 + (Number.parseInt(seed.slice(0, 4), 16) % 7000),
    String((Number.parseInt(seed.slice(4, 6), 16) % 12) + 1).padStart(2, "0"),
    String((Number.parseInt(seed.slice(6, 8), 16) % 28) + 1).padStart(2, "0")
  ].join("-");
  const [briefing] = await db<{ id: number }[]>`
    insert into commodity_briefings (
      briefing_date, template_version, payload_json, docx_path, gen_status
    )
    values (
      ${date}, 1, '{}'::jsonb, ${`e2e-responsive/${randomUUID()}.docx`}, 'succeeded'
    )
    returning id
  `;
  return {
    id: briefing!.id,
    date,
    cleanup: async () => {
      try {
        await db`delete from commodity_briefings where id = ${briefing!.id}`;
      } finally {
        await db.end();
      }
    }
  };
}
