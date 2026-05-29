# scrubber 标注包

## 用途

评估 PII/敏感内容脱敏能力（手机号、邮箱、内网 IP、项目代号等）。

## 样本文件

- `scripts/samples/scrubber-eval.template.jsonl`
- `scripts/samples/scrubber-eval.review.md`

## 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 样本 ID |
| `rawText` | string | 原始文本 |
| `expectedRedactions[]` | array | 期望命中 |
| `expectedRedactions[].type` | string | `phone/email/internal_ip/project_code/person_name` |
| `expectedRedactions[].text` | string | 原始命中内容 |
| `notes` | string | 备注 |

## 生成/回填

- 自动：本 issue 仅提供模板，不自动生成真实样本。
- KYO-58 回填：补真实文本语料。
- 人工补齐：命中类型与边界复核。
