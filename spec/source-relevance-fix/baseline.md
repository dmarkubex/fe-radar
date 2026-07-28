# T-REL-00 现状盘点基线 — source-relevance-fix

> **状态：BLOCKED — needs_human_review（运维执行）**
> **本文件目前是待填模板，不是基线数据。任何卡不得引用本文件作为"已量化验收"的依据。**

- 卡片：T-REL-00（只读盘点，其余卡的前置）
- Owner：运维（human）执行 SQL → 主会话汇总
- 建立日期：2026-07-27　最后更新：2026-07-28

## 为什么还没有数据

T-REL-00 要求"在部署环境（或其只读副本）执行，**不在本机失真网络下判断**"。当前开发机两个前置都不满足：

| 前置         | 实测结果（2026-07-28）                                                                                                        | 结论                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| 生产 DB 可达 | `docker ps` → `Cannot connect to the Docker daemon`；无 `DATABASE_URL`                                                        | 无法执行任何一组 SQL           |
| 网络未失真   | `dig www.nea.gov.cn` → `198.18.0.164`；`www.ndrc.gov.cn` → `198.18.0.165`（fake-ip 段）；四个政府/协会站 curl 全部 `HTTP:000` | **正是根因 R1 的失真网络本身** |

对照组：`https://www.cnesa.org/index/news` 本机 `HTTP:200`，说明不是全网断开，而是**特定站点被代理链路吞掉**——与 `0014` 当初误判"政府站不可达"并批量禁用的成因完全一致。因此本机任何可达性结论都不可采信。

## 待执行 SQL（运维在部署环境按序执行，结果直接粘贴到对应小节）

### 1. 信源盘点

```sql
SELECT tier, category, enabled, count(*) FROM sources GROUP BY 1,2,3 ORDER BY 1,2,3;
```

_结果：待填_

### 2. 近 7 天各源实际产出

```sql
SELECT s.name, s.tier, count(i.id)
FROM sources s
LEFT JOIN items i ON i.source_id = s.id AND i.fetched_at > now() - interval '7 days'
GROUP BY 1,2 ORDER BY 3 DESC;
```

_结果：待填_

### 3. 行业闸门三态分布（判断 fail-open 的 null 占比）

```sql
SELECT is_industry_related, count(*)
FROM item_analysis a JOIN items i ON i.id = a.item_id
WHERE i.fetched_at > now() - interval '7 days'
GROUP BY 1;
```

_结果：待填_

### 4. R7 验证 — 决定 T-REL-08 是否成立

```sql
SELECT alert_type, is_industry_related, count(*)
FROM item_analysis a JOIN items i ON i.id = a.item_id
WHERE i.fetched_at > now() - interval '7 days' AND alert_type IS NOT NULL
GROUP BY 1,2;
```

_结果：待填_

**判读规则**：存在 `alert_type='safety' AND is_industry_related=false` 的行 → 「告警保送」通道实锤成立，T-REL-08 按原优先级实施；计数为 0 → T-REL-08 降级为 P2 预防性加固，不占本批次资源。

### 5. 自动禁用盘点

```sql
SELECT name, fail_count, last_error, last_error_at
FROM sources WHERE enabled = false ORDER BY fail_count DESC;
```

_结果：待填_

## 数据到位后的后续动作

1. 本文件填完 → T-REL-08 依第 4 组数据决定是否启动。
2. 第 5 组数据 + 部署网络 `pnpm --filter @fe-radar/worker verify:sources -- --include-disabled` 生产路径解析报告 → 作为 T-REL-02 写 `0038` 迁移的唯一依据（见 `blocked-register.md`）。
3. 第 2/3 组数据作为 T-REL-06 关键词闸门效果的对照基线（"抽查 20 条无产业无关条目"需对照基线，不接受"感觉好多了"）。
