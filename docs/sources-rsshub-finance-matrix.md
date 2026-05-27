# 财经/自媒体信源 RSSHub 决策矩阵（KYO-60）

评估日期：2026-05-27  
RSSHub 镜像：`diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059`（与 `deploy/stack.yml` 一致）  
Smoke 环境：本地 `docker run -p 1200:1200` + `curl` 统计 `<item>` 数量。

## 部署依赖（v1.0 news 与 v1.1 quotes 共用服务）

| 项              | 值                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Swarm 服务名    | `rsshub`（`deploy/stack.yml`）                                                                                                        |
| 内网 base       | `http://rsshub:1200`                                                                                                                  |
| Worker 环境变量 | `RSSHUB_BASE_URL=http://rsshub:1200`（**v1.1 `rsshub-extract` 使用**；v1.0 news `fetcher_type=rss` 在 seed 中写死绝对 URL，不读模板） |
| 依赖            | 同 stack 内 `redis`（`REDIS_URL=redis://redis:6379`，`CACHE_EXPIRE=3600`）                                                            |
| 对外端口        | 无（`internal: true`，仅 overlay 内访问）                                                                                             |

验证（在 worker 容器内）：

```bash
curl -sS http://rsshub:1200/healthz
curl -sS 'http://rsshub:1200/jiemian/lists/856' | grep -c '<item>'
```

仓库内复现 smoke：`pnpm exec tsx scripts/rsshub-sources-smoke.ts`（需 `RSSHUB_BASE_URL` 可达）。

## 决策矩阵

| 候选源        | 最终方式       | RSSHub route（如有）         | enabled | Smoke items | 理由                                                              |
| ------------- | -------------- | ---------------------------- | ------- | ----------- | ----------------------------------------------------------------- |
| 财联社 能源   | **html**       | `/cls/subject/1066`          | true    | 0           | 专题 API 返回空 feed；`/cls/depth/*` 为股市/头条等，非能源专题    |
| 36氪 新能源   | **rsshub→rss** | `/36kr/information/web_news` | true    | 30          | `/36kr/search/articles/新能源` 仅 1 条；资讯频道稳定              |
| 雪球 行业讨论 | **playwright** | `/xueqiu/hots` 等            | true    | 503         | 反爬，RSSHub 不可用                                               |
| 知乎 电力话题 | **disabled**   | `/zhihu/topic/19577810`      | false   | 503         | 反爬；0011 已 disabled                                            |
| 界面新闻 能源 | **rsshub→rss** | `/jiemian/lists/856`         | true    | 12          | 能源栏目 id=856；旧 lists/55 在 RSSHub 503                        |
| 第一财经 能源 | **rsshub→rss** | `/yicai/headline`            | true    | 20          | `yicai.com/news/energy` 404，无能源专属 route；头条频道作财经代理 |
| 钛媒体 新能源 | **html**       | `/tmtpost/column/*`          | true    | ≤1          | 无 `nav/clean` 稳定 route，column smoke 不足 5                    |
| 网易财经 能源 | **html**       | `/163/news/*`                | true    | 503         | 163 路由在 RSSHub 503                                             |
| 电缆头条      | **playwright** | `/wechat/sogou/电缆头条`     | true    | 1           | 搜狗微信反爬，条目不足                                            |
| 储能头条      | **playwright** | `/wechat/sogou/储能头条`     | true    | 1           | 同上                                                              |

说明：

- **rsshub→rss**：DB `fetcher_type='rss'`，`config.url` 为 `http://rsshub:1200/...` 绝对地址；worker `apps/worker/src/fetchers/rss.ts` 直接抓取，**不**走 `rsshub-extract`。
- 本轮 **未** 新增 `${RSSHUB_BASE_URL}` 模板、未改 fetcher 协议（Reviewer-Plan 裁决）。
- 已接入 RSS 的 3 源见 migration `0013_sources_rsshub_finance.sql`。

## 与 v1.1 `quotes` 隔离

- `fetcher_type=quotes` + `rsshub-extract` 仍仅用于大宗商品简报（SMM 等），与本节 news 源无关。
- 同一 `rsshub` Docker 服务可同时服务两类流量；news 侧仅 HTTP GET RSS XML。
