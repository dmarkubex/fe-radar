import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/.next/**",
      "**/next-env.d.ts",
      "**/coverage/**",
      "**/dist/**",
      "node_modules/**",
      "**/node_modules/**",
      "spec/agent-workflow.html"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    // 各包/根的 *.config.ts 不在任何 tsconfig include 内，关闭类型感知解析避免
    // projectService 报 "not found by the project service"
    files: ["**/*.config.ts", "**/*.config.mjs"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: false
      }
    }
  }
];
