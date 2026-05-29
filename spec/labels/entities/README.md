# entities seed 包（远东系）

## 用途

生成远东系实体初始 seed 草稿，供后续实体识别、告警圈层与运营配置使用。

## 脚本/产物

- 脚本：`scripts/seed/generate-entities-seed.ts`
- 产物：`scripts/seed/entities-seed.sample.jsonl`
- 人工提示：`scripts/seed/entities-seed.hints.md`

## schema（对齐 `packages/db/src/schema.ts`）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | string | 实体类型（如 `company`） |
| `canonicalName` | string | 规范名 |
| `aliases` | string[] | 别名 |
| `circle` | `C1/C2/C3/null` | 关注圈层 |
| `weight` | number | 权重 |
| `meta` | object | 扩展信息（如 ticker、remarks） |

## 命令

```bash
pnpm exec tsx scripts/seed/generate-entities-seed.ts
```

## 生成/回填

- 自动：可生成基础 entities 草稿。
- KYO-58 回填：可从真实新闻中反补新增 aliases。
- 人工补齐：圈层、权重、组织关系与别名精修。
