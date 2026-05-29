# backtest 标注包

## 用途

用于 scorer 的历史回测数据准备与脚本冒烟。

## 样本/脚本

- `scripts/seed/generate-backtest-samples.ts`
- `scripts/samples/scoring-backtest.synthetic.json`

## 字段

与 `scoring-backtest.sample.json` 保持一致，核心是 `title/content/expected.*`。

## 命令

```bash
pnpm exec tsx scripts/seed/generate-backtest-samples.ts
pnpm exec tsx scripts/scoring-backtest.ts scripts/samples/scoring-backtest.synthetic.json /tmp/backtest-report.md
```

## 生成/回填

- 自动：支持 synthetic 样本生成。
- KYO-58 回填：用真实候选替换 synthetic 做 Pearson gate。
- 人工补齐：真实样本打分标签。
