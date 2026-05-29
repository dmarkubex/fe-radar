import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**", "e2e/**"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname),
    },
  },
});
