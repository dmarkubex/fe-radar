# scorer 标注包

## 用途

用于评分回测（D1/D3/D4/D5 + quality）与人工评分对齐验证。

## 样本文件

- `scripts/samples/scoring-backtest.sample.json`
- `scripts/samples/scoring-backtest.synthetic.json`（脚本生成）

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 标题 |
| `content` | string | 正文 |
| `expected.d1Policy` | number | 政策维度 |
| `expected.d3Market` | number | 市场维度 |
| `expected.d4Tech` | number | 技术维度 |
| `expected.d5Business` | number | 商业维度 |
| `expected.qualityScore` | number | 总分 |

## 生成/回填

- 自动：`pnpm exec tsx scripts/seed/generate-backtest-samples.ts`
- KYO-58 回填：替换 synthetic 为真实历史样本。
- 人工补齐：人工目标分与理由。
