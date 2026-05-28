# NER 标注包

## 用途

评估 7 类实体抽取效果，作为 M2/M5 的 NER 验证输入。

## 样本文件

- `scripts/samples/ner-eval.template.jsonl`
- `scripts/samples/ner-eval.review.md`

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 样本唯一标识 |
| `title` | string | 标题 |
| `content` | string | 正文片段 |
| `entities[]` | array | 标注实体集合 |
| `entities[].type` | string | 实体类型 |
| `entities[].text` | string | 命中文本 |
| `entities[].start/end` | number | 偏移区间 |

## 生成/回填

- 自动：无。
- KYO-58 回填：补充真实新闻文本。
- 人工补齐：实体边界与类型。
