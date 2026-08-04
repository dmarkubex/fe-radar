# 信源重建 Gate 0 — Design

## 1. 复用优先

- 继续使用 `sources.config` 存 Gate 0 元数据，不新建信源配置表。
- 继续使用 worker `verify-sources` 做生产路径 smoke。
- 继续使用 `items` + `item_analysis.is_industry_related` 计算产出与相关率。
- 继续使用现有 admin source-health 页面展示即时状态；本期不新增 UI。

## 2. 信源配置

计入 Gate 0 的 source config 增加可选字段：

```json
{
  "gate0": {
    "domains": ["industry_policy", "downstream"],
    "signalKinds": ["tender"],
    "maxAgeHours": 168
  }
}
```

`domains` 仅允许 requirements §2 六个枚举；`signalKinds` 本期只定义 `tender`。空数组或缺失表示不计入对应 Gate 0 统计。

## 3. 抓取运行历史

新增 `source_fetch_runs`：

- `id BIGSERIAL PRIMARY KEY`
- `source_id BIGINT NOT NULL REFERENCES sources(id) ON DELETE CASCADE`
- `started_at TIMESTAMPTZ NOT NULL`
- `finished_at TIMESTAMPTZ NOT NULL`
- `succeeded BOOLEAN NOT NULL`
- `item_count INT NOT NULL DEFAULT 0`
- `error_code TEXT NULL`

只存运行元数据，不存响应体或 HTML；保留 90 天并纳入 cleanup。记录失败不得覆盖原始抓取异常，也不得让成功抓取被判失败。

## 4. 复检 CLI

扩展生产版 `verify-sources`：

- `--source-id <id>`：只复检一个源，便于每源独立进程，避免单代理熔断污染后续结果。
- `--json`：输出稳定 JSONL，供审计和 Gate 脚本读取。
- 默认行为和现有文本输出保持兼容。

不在脚本内自动启用/禁用信源。

## 5. Gate 评估器

新增 worker CLI `source-gate0`，只读查询生产 DB并输出：

- 六域健康覆盖数和主办方去重数。
- 官方招标平台健康数、主办方去重数和招标/中标公告分类计数。
- 每源 7 天 attempts/success rate、items、industry relevance ratio、freshness。
- 单源及前三源产出占比。
- 总体 `PASS/BLOCKED/FAIL` 与逐项原因。

7 天历史不足时返回 `BLOCKED` 并非 `PASS`；失败状态退出码为 1，PASS 为 0。

## 6. 信源处置

- 当前通过且内容相关的源只打 Gate 0 标签；已启用源不改变 admin 配置。
- 停用候选先修发布时间/adapter，再生产 smoke；通过后用前向 migration 或 admin 明确启用。
- URL 失效、选择器失效和 robots 禁止源保持软禁，不物理删除历史引用行。
- 新增源必须默认 `enabled=false`、`ON CONFLICT DO NOTHING`，不覆盖 admin。
- 招标平台优先复用公开 HTML/JSON 列表；公开数据接口未定位前不为单页应用新增浏览器自动化，更不得处理验证码。

## 7. 发布顺序

1. 部署 schema/worker 观测能力。
2. 给现有健康源配置 Gate 0 domains。
3. 修复/新增候选源，逐源生产 smoke 后激活。
4. 开始连续 7 天 soak。
5. Gate 报告 PASS 后才允许转正式验收。
