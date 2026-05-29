# FE-Radar Scripts

## seed / dataset (KYO-54)

Release v1.0 B 类合成数据见 `scripts/seed/README.md`。

```bash
pnpm --filter @fe-radar/db seed:release
pnpm exec tsx scripts/seed/generate-embedding-dataset.ts
pnpm exec tsx scripts/seed/generate-backtest-samples.ts
```

## scoring-backtest

`scripts/scoring-backtest.ts` compares human-labeled historical samples with the
current or candidate scoring configuration. It is read-only: samples are loaded
from JSON and the script writes a Markdown report to stdout or a file.

```bash
pnpm exec tsx scripts/scoring-backtest.ts samples/scoring.json candidate-config.json report.md
```

The report includes accuracy, mean absolute score error, curated overlap, and
per-sample score deltas. Use it before changing `scoring_config` weights or
thresholds.

## M2 label evaluator

`scripts/m2-label-evaluator.ts` reads the KYO-7/KYO-58 label package under
`spec/labels` and writes a Markdown gate report for the M2 release metrics:
prefilter accuracy, NER recall, scorer score MSE, scrubber recall/false
positive rate, and backtest Pearson correlation.

```bash
pnpm labels:m2 -- --out /tmp/m2-label-gate.md
pnpm labels:m2 -- --strict --out /tmp/m2-label-gate.md
```

The evaluator treats only human fields under `expected.*`, `label`,
`entities[]`, and `expectedRedactions[]` as truth. Model/reference columns are
reported as predictions only, and missing human labels produce a
`blocked/missing labels` verdict instead of a fabricated metric.
