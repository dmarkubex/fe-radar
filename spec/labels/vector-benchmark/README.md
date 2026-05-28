# vector benchmark 数据包

## 用途

用于 pgvector 检索性能与召回评估（50K/500K）。

## 脚本/产物

- `scripts/seed/generate-embedding-dataset.ts`
- `scripts/seed/embedding-manifest.json`
- `scripts/seed/embedding-sample.jsonl`
- `generated/embedding/vectors-50k.jsonl`
- `generated/embedding/vectors-500k.jsonl`

## 命令

```bash
pnpm exec tsx scripts/seed/generate-embedding-dataset.ts
VECTOR_BENCH_ROWS=50000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts
VECTOR_BENCH_ROWS=500000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts
```

## 归类

- 自动生成：是
- KYO-58 回填：否
- 人工补齐：否
