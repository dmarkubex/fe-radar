import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    // T-SEC-12: SSRF 守卫会做真实 DNS 解析；测试环境（离线 / fixture）默认关闭，
    // 由 http.test.ts 内的 SSRF block 用例（literal IP，无需 DNS）单独覆盖。
    // 生产默认开启（env 未设时 guard 启用）。
    env: {
      SSRF_GUARD_ENABLED: "false"
    }
  },
});
