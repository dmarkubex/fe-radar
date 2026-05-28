# KYO-58 真实样本标注交接（KYO-75）

## 1) 交付范围

- 真实样本来源：`tmp/kyo-58-local-smoke-20260528/annotation-candidates.csv`（共 275 条）。
- 已回填到：`spec/labels/<class>/inputs/`（9 类目录均有输入位或显式不适用说明）。
- 严格隔离：
  - 真实样本：本次仅使用 KYO-58 导出。
  - synthetic 样本：仍保留在 KYO-54/脚本生成路径，**不混用**。

## 2) 各类路径与样本量

| 类别 | 输入路径 | 样本数 | 说明 |
| --- | --- | ---: | --- |
| prefilter | `spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv` | 275 | 产业相关性二分类 |
| ner | `spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl` | 275 | 7 类实体标注 |
| scorer | `spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json` | 275 | D1/D3/D4/D5 + 质量分人工对齐 |
| scrubber | `spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl` | 275 | 脱敏命中标注 |
| backtest | `spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json` | 275 | 评分回测真实输入 |
| entities | `spec/labels/entities/inputs/real-kyo58-entities-inputs.csv` | 275 | 实体 seed 候选补齐 |
| timeline | `spec/labels/timeline/inputs/REAL_SAMPLES_NOT_APPLICABLE.md` | 0 | 该类由 seed 生成，不直接回填候选 |
| daily-report | `spec/labels/daily-report/inputs/REAL_SAMPLES_NOT_APPLICABLE.md` | 0 | 该类为日报产物，不直接回填候选 |
| vector-benchmark | `spec/labels/vector-benchmark/inputs/REAL_SAMPLES_NOT_APPLICABLE.md` | 0 | 该类由 benchmark 数据生成 |

统计汇总见：`spec/labels/_meta/sample-counts.json`。

## 3) 字段释义与人工填写要求

### prefilter（CSV）

- 关键列：`id`, `title`, `content`, `label`, `reason`。
- 必填列：`label`（`related`/`unrelated`）。
- 复核列：`reason`, `review_notes`。
- 辅助列：`model_suggestion`（机器建议，人工可覆盖）。

### ner（JSONL）

- 关键列：`id`, `title`, `content`, `entities[]`。
- 必填列：`entities[].type`, `entities[].text`, `entities[].start/end`。
- 复核列：`notes`, `reviewer`。
- 边界与标签复核标准：参考 `scripts/samples/ner-eval.review.md`。

### scorer / backtest（JSON）

- 关键列：`title`, `content`, `expected.*`。
- 必填列：`expected.d1Policy`, `expected.d3Market`, `expected.d4Tech`, `expected.d5Business`, `expected.qualityScore`。
- backtest 额外必填：`expected.curated`。
- 复核列：`reason`, `reviewer`。
- 参考列：`model_reference.*` 或 `reference.*` 仅作对照，不替代人工结论。
- 注：`content` 字段来自 KYO-58 导出的 `content_preview`（约 1.5KB 截断预览）；如需全文请回溯抓取明细库。

### scrubber（JSONL）

- 关键列：`rawText`, `expectedRedactions[]`。
- 必填列：`expectedRedactions[].type`, `expectedRedactions[].text`。
- 复核列：`notes`, `reviewer`。

### entities（CSV）

- 关键列：`candidate_entities`, `canonical_name`, `type`, `aliases`, `circle`, `weight`。
- 必填列：`canonical_name`, `type`。
- 复核列：`aliases`, `circle`, `weight`, `reviewer_notes`。

## 4) 缺口清单（需业务补充）

- `timeline`：缺按页面口径整理的历史真实时间线样本。
- `daily-report`：缺日报成稿人工质量标注样本。
- `vector-benchmark`：缺“检索结果是否相关”的人工对照集。

## 5) 回传约定

- 研究员完成后，将已填文件放回原路径并保留文件名。
- 禁止把 synthetic 样本写入 `real-kyo58-*` 文件。
- 如需新增样本，新增文件请用 `real-manual-*` 前缀，并在 `spec/labels/_meta/sample-counts.json` 同步更新数量与来源。
- entities 回传 CSV 维持 snake_case（`canonical_name` 等）；导入 `scripts/seed/generate-entities-seed.ts` 前需做 snake_case -> camelCase（如 `canonicalName`）字段映射。
