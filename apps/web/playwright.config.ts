import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm --filter @fe-radar/web start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      AUTH_SECRET: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "local-e2e-auth-secret-at-least-32-characters",
      AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST ?? "true",
      NEXTAUTH_URL: process.env.NEXTAUTH_URL ?? baseURL,
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://fe_radar:fe_radar_dev@localhost:5432/fe_radar"
    }
  }
});
