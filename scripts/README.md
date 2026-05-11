# FE-Radar Scripts

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
