# KYO-73 标注包索引（Phase 1 并行准备）

本目录用于整理 KYO-7 Phase 1 的标注包/seed 骨架，明确三类来源：

- **自动生成**：本 issue 已可本机脚本生成。
- **等待 KYO-58 回填**：依赖真实抓取样本，当前仅保留模板。
- **人工补齐**：需要产业研究员做业务判断，不由脚本替代。

## 分类总览

| 类别 | 目录 | 主要样本/脚本 | 当前状态 | 来源归类 |
| --- | --- | --- | --- | --- |
| prefilter | `spec/labels/prefilter/` | `scripts/samples/prefilter-eval.template.csv` | 已有模板 | 人工补齐 + KYO-58 回填 |
| ner | `spec/labels/ner/` | `scripts/samples/ner-eval.template.jsonl` | 已有模板 | 人工补齐 + KYO-58 回填 |
| scorer | `spec/labels/scorer/` | `scripts/samples/scoring-backtest.sample.json` | 已有模板 | 人工补齐 + KYO-58 回填 |
| scrubber | `spec/labels/scrubber/` | `scripts/samples/scrubber-eval.template.jsonl` | 本 issue 新增 | 人工补齐 + KYO-58 回填 |
| backtest | `spec/labels/backtest/` | `scripts/seed/generate-backtest-samples.ts` | 已可生成 synthetic | 自动生成（真实评估仍需 KYO-58） |
| timeline | `spec/labels/timeline/` | `packages/db/scripts/seed-release-data.ts` | 已可生成 | 自动生成 |
| entities | `spec/labels/entities/` | `scripts/seed/generate-entities-seed.ts` | 本 issue 新增 | 自动生成 + 人工补齐 |
| daily-report | `spec/labels/daily-report/` | `packages/db/scripts/seed-release-data.ts` | 已可生成 | 自动生成 |
| vector-benchmark | `spec/labels/vector-benchmark/` | `scripts/seed/generate-embedding-dataset.ts` | 已可生成 | 自动生成 |

## 快速生成命令

```bash
pnpm --filter @fe-radar/db seed:release
pnpm exec tsx scripts/seed/generate-backtest-samples.ts
pnpm exec tsx scripts/seed/generate-embedding-dataset.ts
pnpm exec tsx scripts/seed/generate-entities-seed.ts
```

## 三类文件清单

### A. 等待 KYO-58 真实样本回填

- `scripts/samples/prefilter-eval.template.csv`
- `scripts/samples/ner-eval.template.jsonl`
- `scripts/samples/scoring-backtest.sample.json`
- `scripts/samples/scrubber-eval.template.jsonl`

### B. 需要产业研究员人工补齐

- `scripts/samples/ner-eval.review.md`（实体边界与标签一致性复核）
- `scripts/samples/scrubber-eval.review.md`（PII 分类、漏报/误报判定）
- `scripts/seed/entities-seed.hints.md`（圈层、别名、权重校对）

### C. 本 issue 自动生成

- `scripts/seed/generate-entities-seed.ts` → `scripts/seed/entities-seed.sample.jsonl`
- `scripts/seed/generate-backtest-samples.ts` → `scripts/samples/scoring-backtest.synthetic.json`
- `scripts/seed/generate-embedding-dataset.ts` → `generated/embedding/*.jsonl`
- `packages/db/scripts/seed-release-data.ts` → timeline/daily seed
