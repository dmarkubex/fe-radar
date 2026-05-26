# KYO-54 · Release v1.0 B 类 seed / dataset 脚本

固定 seed、幂等生成。路径与 KYO-7 Phase 1-A 对齐。

## 1. Timeline seed + blocked + 3 天日报

**脚本**: `packages/db/scripts/seed-release-data.ts`

- 21 条 timeline（20 可见 + 1 blocked，`summary_zh='[需人工脱敏]'`）
- 固定 URL 前缀 `https://seed.fe-radar.local/timeline/` → 可重复 upsert
- 3 天日报：`2026-05-24` / `2026-05-25` / `2026-05-26`

```bash
pnpm --filter @fe-radar/db migrate
pnpm --filter @fe-radar/db seed:release
```

## 2. Embedding 数据集（50K + 500K）

**脚本**: `scripts/seed/generate-embedding-dataset.ts`（seed=`54001`）

| 产物         | 路径                                     | 进 git |
| ------------ | ---------------------------------------- | ------ |
| 50K vectors  | `generated/embedding/vectors-50k.jsonl`  | 否     |
| 500K vectors | `generated/embedding/vectors-500k.jsonl` | 否     |
| manifest     | `scripts/seed/embedding-manifest.json`   | 是     |
| 小样本       | `scripts/seed/embedding-sample.jsonl`    | 是     |

```bash
pnpm exec tsx scripts/seed/generate-embedding-dataset.ts
VECTOR_BENCH_ROWS=50000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts
VECTOR_BENCH_ROWS=500000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts
```

## 3. Backtest synthetic 样本（≥500 · 阻塞兜底）

**脚本**: `scripts/seed/generate-backtest-samples.ts`（seed=`54002`）

**产物**: `scripts/samples/scoring-backtest.synthetic.json`

**为何 synthetic / 非真实历史**（Phase 1-B 未解锁）：

- Build server / 生产库尚未装机，Phase 2「跑一轮采集 → 导出候选」未完成
- 无已标注的历史 scoring 样本可导出
- 本文件 **仅** 用于 `scoring-backtest.ts` 脚本校验与 CI 冒烟，**不能**替代 Phase 1-B / release smoke 的真实 backtest Pearson gate

```bash
pnpm exec tsx scripts/seed/generate-backtest-samples.ts
pnpm exec tsx scripts/scoring-backtest.ts scripts/samples/scoring-backtest.synthetic.json /tmp/backtest-report.md
```

## 幂等性

| 脚本                       | 机制                                      |
| -------------------------- | ----------------------------------------- |
| seed-release-data          | `ON CONFLICT (url)` / `(date)` upsert     |
| generate-embedding-dataset | 固定 seed PRNG，同 seed 同输出            |
| generate-backtest-samples  | 固定 seed PRNG + curateItem 派生 expected |
