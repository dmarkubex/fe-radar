# prefilter 标注包

## 用途

用于验证 prefilter 对产业相关性的二分类效果（相关/不相关）。

## 样本文件

- `scripts/samples/prefilter-eval.template.csv`
- `scripts/samples/prefilter-eval.json`（可选示例）

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 样本唯一标识 |
| `title` | string | 标题 |
| `content` | string | 摘要/正文片段 |
| `label` | `related` \| `unrelated` | 人工标签 |
| `reason` | string | 判定理由（可空） |

## 生成/回填

- 自动：无。
- KYO-58 回填：需要真实抓取标题与正文片段。
- 人工补齐：`label` 与 `reason`。
