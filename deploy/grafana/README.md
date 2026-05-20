# deploy/grafana

Grafana provisioning 配置与 dashboard JSON 文件。

## 目录结构

```
deploy/grafana/
├── dashboards/
│   ├── fe-radar.json               # v1.0 FE-Radar Operations 面板（3 面板）
│   └── commodity-briefing.json     # v1.1 Commodity Briefing 面板（5 面板，tag=v1.1）
└── provisioning/
    ├── alerts/
    │   └── commodity-briefing.yaml # v1.1 告警规则（4 条）
    └── dashboards/
        └── commodity-briefing.yaml # v1.1 dashboard provisioning 注册
```

## Dashboards

### fe-radar.json（v1.0）

| 面板                         | 类型 | 说明                       |
| ---------------------------- | ---- | -------------------------- |
| Priority backlog >24h ratio  | stat | BullMQ priority 队列积压率 |
| Scrubber manual review queue | stat | 人工审核队列长度           |
| Merge conflicts pending      | stat | 钉钉账号合并冲突待处理数   |

### commodity-briefing.json（v1.1，tag=v1.1）

| 面板                            | 类型             | 说明                                                                                                                                                                                            |
| ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Briefing Gen 成功率（7d）       | stat + sparkline | `commodity_briefings.gen_status=succeeded / total`，近 7 日滚动                                                                                                                                 |
| Briefing Push 成功率（24h）     | stat + sparkline | `briefing_pushes.push_status=succeeded / total`，近 24h 滚动                                                                                                                                    |
| Briefing 字段覆盖率（当日均值） | gauge            | `payload_json` 中 `BRIEFING_SCHEMA` 7 段完整度均值：`cu.logic_summary` / `cu.outlook.trend` / `lc.logic_summary` / `lc.outlook.trend` / `macro_summary` / `risk_notes[]` / `procurement_advice` |
| Quotes Fetch 时延（P50 / P95）  | timeseries       | `commodity_quotes.fetched_at - observed_at` 中位数与 p95，按小时聚合                                                                                                                            |
| Kimi 月度成本估算（CNY）        | stat + sparkline | 当月 briefing-gen Kimi token 用量折算成本（input ¥0.015/1K, output ¥0.06/1K）                                                                                                                   |

## 告警规则（v1.1）

`provisioning/alerts/commodity-briefing.yaml` 包含 4 条 Grafana Unified Alerting 规则：

| uid                  | 规则                                     | 阈值                       | 严重度   |
| -------------------- | ---------------------------------------- | -------------------------- | -------- |
| cb-gen-consec-fail   | briefing-gen 连续 2 工作日失败           | sum(failed) > 2 in 48h     | critical |
| cb-push-fail-rate    | briefing-push 失败率 > 50%（rolling 1h） | fail_rate > 0.5            | critical |
| cb-source-fail-count | 单 source fail_count ≥ 7（quotes 信源）  | count(fail_count≥7) > 0    | warning  |
| cb-kimi-monthly-cost | Kimi 月度成本超预算（NFR-105）           | monthly_cost_cny > 100 CNY | warning  |

> NFR-105 预算阈值默认 ¥100 CNY/月；admin 可在 Grafana 告警规则 UI 中调整。

## 数据源

所有面板与告警规则使用 datasourceUid `fe-radar-postgres`（Grafana Postgres 数据源，需在 Grafana UI 或 provisioning/datasources 中配置）。

## 部署说明

1. `dashboards/*.json` 放入 Grafana `GF_PATHS_PROVISIONING/dashboards/` 对应目录（默认 `/etc/grafana/dashboards`）
2. `provisioning/dashboards/commodity-briefing.yaml` 放入 `/etc/grafana/provisioning/dashboards/`
3. `provisioning/alerts/commodity-briefing.yaml` 放入 `/etc/grafana/provisioning/alerting/`
4. 重启或 reload Grafana（`grafana-cli admin reset-admin-password` 不需要；`POST /api/admin/provisioning/dashboards/reload`）
