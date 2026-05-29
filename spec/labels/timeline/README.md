# timeline seed 包

## 用途

用于 M3 页面与接口演示的最小 timeline 数据集。

## 脚本

- `packages/db/scripts/seed-release-data.ts`

## 输出

- timeline：20 条可见 + 1 条 blocked
- 固定 URL 前缀与日期，保证幂等 upsert

## 命令

```bash
pnpm --filter @fe-radar/db migrate
pnpm --filter @fe-radar/db seed:release
```

## 归类

- 自动生成：是
- KYO-58 回填：否（这是演示 seed，不替代真实采集）
- 人工补齐：可选（文本质量增强）
