import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 根目录直接跑 vitest 时委托到各包自身配置（apps/web 含 @ alias 与 e2e 排除），
    // 与 `pnpm -r test` 的逐包行为保持一致
    projects: [
      "apps/*",
      "packages/*",
      {
        test: {
          name: "scripts",
          include: ["scripts/__tests__/**/*.test.ts"],
          globals: true,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"]
    }
  }
});
