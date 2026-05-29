# daily-report seed 包

## 用途

用于日报页面与生成流程的最小回测输入。

## 脚本

- `packages/db/scripts/seed-release-data.ts`

## 输出

- `2026-05-24` / `2026-05-25` / `2026-05-26` 三天日报 seed

## 命令

```bash
pnpm --filter @fe-radar/db seed:release
```

## 归类

- 自动生成：是
- KYO-58 回填：否（真实日报应由线上流程生成）
- 人工补齐：可选（文案质量与结构校对）
