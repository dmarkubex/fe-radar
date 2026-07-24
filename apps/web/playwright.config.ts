import { defineConfig, devices } from "@playwright/test";

const responsiveProjects = [
  ["mobile-375", 375, 667],
  ["edge-639", 639, 800],
  ["edge-640", 640, 800],
  ["edge-759", 759, 800],
  ["edge-760", 760, 800],
  ["tablet-768", 768, 1024],
  ["edge-800", 800, 800],
  ["edge-899", 899, 800],
  ["edge-900", 900, 800],
  ["desktop-1024", 1024, 768],
  ["edge-1099", 1099, 800],
  ["edge-1100", 1100, 800],
  ["edge-1179", 1179, 800],
  ["edge-1180", 1180, 800],
  ["desktop-1280", 1280, 720]
] as const;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    ...responsiveProjects.map(([name, width, height]) => ({
      name,
      testMatch: /responsive\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width, height }
      }
    }))
  ],
  webServer: {
    command: "pnpm --filter @fe-radar/web dev",
    env: {
      PROXY_DISABLED_FILE:
        process.env.PROXY_DISABLED_FILE ?? "/tmp/fe-radar-e2e-disabled-proxies.json",
      PROXY_LIST_FILE:
        process.env.PROXY_LIST_FILE ?? "/tmp/fe-radar-e2e-proxies.txt"
    },
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true",
    timeout: 60_000
  }
});
