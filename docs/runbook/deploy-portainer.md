# FE-Radar Portainer 部署 Runbook（首部署 + fetch 真连网验证）

> 目标：用 Portainer（Docker Swarm stack）把 FE-Radar 部署到内网服务器，并**先验证信源能否真实抓取**。
> 本文基于对 `deploy/stack.yml` / Dockerfile / 源码的实际核查，**先列会卡住首部署的真实缺口，再给步骤**。

---

## 0. 部署就绪度审计（先看，否则会踩坑）

| #      | 缺口                                          | 影响                                                                                                                                                                 | 状态                                                                                                                                                            |
| ------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | **`*_FILE` 密钥未在应用层读取**               | stack.yml 用 `NEXTAUTH_SECRET_FILE`/`DEEPSEEK_API_KEY_FILE`/… secret 约定，但代码只读纯 env，**只有 `PROXY_LIST_FILE` 真被读** → 照原样部署 web 起不来、LLM 无 key。 | ✅ **已修**：`deploy/docker-entrypoint-secrets.sh` + web/worker 镜像 ENTRYPOINT 把 `*_FILE` 注入纯 env；未设 `*_FILE` 时 no-op，故纯 env 与 secret 两种都能用。 |
| **G2** | **stack 内没有 migration/seed 步骤**          | DB 启动是空库，runner 镜像不含 tsx/db 脚本。                                                                                                                         | ✅ **已修**：新增 `deploy/Dockerfile.migrate` 一次性镜像（见 §4）。                                                                                             |
| **G6** | **stack.yml worker/scheduler command 路径错** | 原 `dist/main.js`/`dist/scheduler.js` 不存在（真实路径 `dist/apps/worker/src/...`）→ worker/scheduler 起来即崩。                                                     | ✅ **已修**：worker 用镜像默认 CMD；scheduler 改为正确路径。                                                                                                    |
| **G3** | **Qwen/LLM 未配置**                           | worker 能启动但下游 prefilter/NER/embedding 会连容器内 `localhost:8001`，全链路必失败。                                                                              | ✅ **已修**：生产 stack 要求 Portainer env 设置 `QWEN_BASE_URL`，缺失时部署期直接失败；fetch-only compose 可继续不配 LLM。                                      |
| G4     | MinIO bucket / lifecycle 漏配                 | 简报/备份需要 `fe-radar-briefings`/`fe-radar-backups`；漏建桶会 `NoSuchBucket`，漏 lifecycle 会违反 90 天 docx retention。                                           | ✅ **已修**：`deploy/scripts/minio-provision.sh` 可幂等建桶并给 `fe-radar-briefings` 写 90 天 lifecycle（§6）。                                                 |
| G5     | `DB_PASSWORD` 双重身份                        | DATABASE_URL 里 `${DB_PASSWORD}` 是 **stack 部署期变量**（非 secret 文件）；postgres 自己读 `db_password` secret                                                     | ℹ️ 部署时在 Portainer stack environment 设 `DB_PASSWORD`，与 postgres 密码一致（§3）                                                                            |
| G7     | web/worker 早于 migration 连空库              | Swarm 不等待 migration；应用直连空库会反复崩溃或写出半初始化状态。                                                                                                   | ✅ **已修**：web/worker/scheduler ENTRYPOINT 增加关键表探针；部署后必须立即执行 §4 migration 阻塞门，探针超时则 migrate 后强制重启应用服务。                    |

> **结论**：阻塞性缺口 G1/G2/G3/G4/G6/G7 已在仓库修好；首部署按下文走即可。注意这些镜像/脚本因本机无 Docker **未做构建自测**，请在 build server 首次构建时留意。

---

## 1. 前置：自建镜像走内网 Harbor `harborssl.fegroup.cn/custom-project`

stack.yml 与 compose.fetch-smoke.yml 的 **FE-Radar 自建镜像**已改为 Harbor 路径；公共镜像保持官方镜像名，由部署服务器直接拉取。你把 compose 贴进 Portainer 前，需保证 Harbor 里有 5 个自建镜像、且 Portainer/Docker 主机能登录 Harbor 拉取。下面命令均为手工逐条执行，不依赖自动脚本。

**1.1 构建并推送 5 个自建镜像**（在有 Docker 的构建机，仓库根目录）：

```bash
docker login harborssl.fegroup.cn        # 先登录 Harbor

R=harborssl.fegroup.cn/custom-project
docker build -f deploy/Dockerfile.postgres-zhparser -t $R/fe-radar/postgres-zhparser:pg16 .
docker build -f deploy/Dockerfile.worker  -t $R/fe-radar-worker:latest  .
docker build -f deploy/Dockerfile.migrate -t $R/fe-radar-migrate:latest .
docker build -f deploy/Dockerfile.web     -t $R/fe-radar-web:latest     .   # web 首测可不上
docker build -f deploy/Dockerfile.backup  -t $R/fe-radar-backup:latest  .
docker push $R/fe-radar/postgres-zhparser:pg16
docker push $R/fe-radar-worker:latest
docker push $R/fe-radar-migrate:latest
docker push $R/fe-radar-web:latest
docker push $R/fe-radar-backup:latest
```

**1.2 公共镜像不进 Harbor**

公共镜像保持官方路径，部署服务器直接拉取：`redis:7-alpine`、`minio/minio:RELEASE.2025-09-07T16-13-09Z`、`grafana/grafana:12.1.1`、`diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059`。

> ⚠️ **两点须核对**：
>
> 1. **自建镜像名必须和 stack 一致**：`fe-radar-web`、`fe-radar-worker`、`fe-radar-migrate`、`fe-radar-backup`、`fe-radar/postgres-zhparser`。
> 2. **公共镜像由服务器直连拉取**：如果部署服务器不能访问 Docker Hub / 公共 registry，再单独决定是否镜像到 Harbor。
>
> **Portainer 拉取凭据**：Portainer → Registries 添加 `harborssl.fegroup.cn`（用户名/密码），或确保 Docker 主机已 `docker login harborssl.fegroup.cn`，否则 stack 起不来（ImagePullBackOff / no basic auth credentials）。

> 镜像较大（worker 含 Playwright Chromium ~几百 MB），首次构建较慢。

---

## 2. 首部署决策（建议）

| 决策 | 首测建议                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 范围 | **先只验证 fetch**（postgres + redis + worker + scheduler + rsshub），web/MinIO/grafana/backup 可暂不上或后补 |
| 密钥 | 用**纯 env**（§3），不碰 `_FILE`/secret，避开 G1                                                              |
| LLM  | 暂不配 Qwen/DeepSeek/Kimi，fetch 不需要                                                                       |
| 信源 | migrate 自动 seed ~75 个 enabled 真实源（rss/html/playwright/announcement）；quotes 默认禁用                  |

---

## 3. Portainer 部署步骤

> **最省事路径（推荐首测）**：直接用现成的单机 compose `deploy/compose.fetch-smoke.yml` —— 纯 env、含一次性 migrate+seed、命令路径已对、不用建 secret、不用内联改 stack。Portainer → Stacks → Add stack → 贴该文件即可；或 `docker compose -f deploy/compose.fetch-smoke.yml up -d`。下面的逐条步骤是用「生产 stack.yml」手动部署时的参考。

1. **建 overlay 网络**：stack.yml 已声明 `internal`（`internal: true`），Portainer 部署 stack 时自动建。
2. **Stacks → Add stack**，名 `fe-radar`，把 `deploy/stack.yml` 贴进 Web editor（或用 Git repo 方式）。
3. **首测精简版改动**（在贴入的 stack 内联改，避免动仓库文件）：
   - `web`/`worker`/`scheduler`/`postgres` 里**把 `_FILE` 行换成纯 env**，并删掉对应 `secrets:` 段。例如：
     ```yaml
     web:
       environment:
         NODE_ENV: production
         TZ: Asia/Shanghai
         DATABASE_URL: postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar
         REDIS_URL: redis://redis:6379
         NEXTAUTH_URL: http://fe-radar.internal
         NEXTAUTH_SECRET: <32+ 位随机串> # 替代 NEXTAUTH_SECRET_FILE
         DINGTALK_ENABLED: "false" # 本地账号登录（M0–M3）
     postgres:
       environment:
         POSTGRES_DB: fe_radar
         POSTGRES_USER: fe_radar
         POSTGRES_PASSWORD: CHANGE_ME_DBPW # 替代 POSTGRES_PASSWORD_FILE，需与上面 DATABASE_URL 一致
     worker:
       environment:
         DATABASE_URL: postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar
         REDIS_URL: redis://redis:6379
         RSSHUB_BASE_URL: http://rsshub:1200
         PROXY_POOL_ENABLED: "false"
         # 首测不配 LLM；要跑全链路再加 QWEN_BASE_URL / DEEPSEEK_API_KEY / KIMI_API_KEY
     ```
   - `DB_PASSWORD` 这个 `${...}` 插值：在 Portainer stack 的 **Environment variables** 里设 `DB_PASSWORD=CHANGE_ME_DBPW`（若改用上面写死的纯 env 则不需要）。
   - 首测可删 `web` 之外不需要的 `minio`/`grafana`/`backup`（fetch 不依赖）。
4. **Deploy the stack**，先等 `postgres`/`redis`/`minio`/`rsshub` 起来。`web`/`worker`/`scheduler` 会在 entrypoint 里等待关键表存在；此时不要判定应用失败，立刻执行 §4 migration 阻塞门。

> 生产正式部署再走 secret 方案（§6），首测以「能抓到」为先。

---

## 4. 迁移 + seed（阻塞门，G2/G7）

用 §1 构建好的 `harborssl.fegroup.cn/custom-project/fe-radar-migrate:latest` 一次性镜像（已含 tsx + db 脚本），在能连 `internal` overlay 的 manager 节点执行。**这是部署阻塞门**：未完成前不要开放 web，也不要开始抓取验证。

```bash
# 1) 建表 + seed ~75 个 enabled 信源
docker run --rm --network fe-radar_internal \
  -e DATABASE_URL='postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar' \
  harborssl.fegroup.cn/custom-project/fe-radar-migrate:latest

# 2) 建后台登录账号（可指定用户名/密码）
docker run --rm --network fe-radar_internal \
  -e DATABASE_URL='postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar' \
  -e SEED_ADMIN_USERNAME=admin -e SEED_ADMIN_PASSWORD='<强密码>' \
  harborssl.fegroup.cn/custom-project/fe-radar-migrate:latest pnpm --filter @fe-radar/db seed:admin
```

> overlay 网络名通常是 `<stack名>_<网络名>`，即 `fe-radar_internal`；`docker network ls` 确认。
> `migrate` 同时建表 + seed 信源（~75 enabled）；`seed:admin` 建登录账号。
>
> **兜底（无 migrate 镜像时）**：migrations 是纯 `.sql`，按编号顺序灌：
>
> ```bash
> for f in $(ls packages/db/migrations/0*.sql | sort); do
>   docker exec -i <postgres容器> psql -U fe_radar -d fe_radar < "$f"
> done
> ```
>
> 但 admin 账号仍需 `seed:admin`（bcrypt 哈希，不能纯 SQL 灌）。

**验证迁移成功**：

```bash
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c "SELECT fetcher_type, count(*) FILTER (WHERE enabled) AS enabled, count(*) AS total FROM sources GROUP BY 1 ORDER BY 1;"
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c "SELECT to_tsvector('zhparser','电力电缆储能');"   -- zhparser 生效
```

若 `web`/`worker`/`scheduler` 在 migration 完成前因 180 秒 schema probe 超时重启，migration 成功后执行：

```bash
docker service update --force fe-radar_web
docker service update --force fe-radar_worker
docker service update --force fe-radar_scheduler
```

---

## 5. 触发并观测 fetch 真连网验证

scheduler 默认每 6 小时整点调度一轮（`0 */6 * * *`）。要立刻测，手动入队一次调度任务（向 Redis 推 `schedule-fetch-sources`，或临时把 cron 改密；最简单是直接观测下一个整点，或在 worker 容器内用一段 tsx 触发）。**最省事**：等下一整点，或重启 scheduler 让它补一次（视实现）。

**一键自检（推荐）**：

```bash
deploy/scripts/fetch-smoke-check.sh   # 输出：各类型 enabled 数 / 抓到条目数+最近抓取时间 / 失败源 / zhparser / rsshub
```

**或手动观测（不需要 LLM、不需要登录）**：

```bash
# 真正抓到的条目数 + 最近抓取时间（注意：sources 无 last_fetched_at 列，时间在 items.fetched_at）
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c \
 "SELECT s.fetcher_type, count(i.id) AS items, max(i.fetched_at) AS last_fetch FROM sources s LEFT JOIN items i ON i.source_id=s.id GROUP BY 1 ORDER BY items DESC;"
# 失败源（fail_count / last_error）
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c \
 "SELECT fetcher_type, name, fail_count, left(last_error,60) FROM sources WHERE enabled AND (fail_count>0 OR last_error IS NOT NULL) ORDER BY fail_count DESC LIMIT 30;"
# worker 日志（看 'fetch succeeded' / 'fetch failed' + correlationId）
docker compose -f deploy/compose.fetch-smoke.yml logs worker --since 10m | grep -E "fetch (succeeded|failed)|pipeline enqueued"
```

**按 5 类逐项核对**（对应之前讨论的抓取方式）：

- `rss` —— 经 rsshub，先确认 `curl http://rsshub:1200/healthz` ok（worker 容器内）
- `html` —— 政府/普通站；**注意**：T1 政府站需代理池（首测 `PROXY_POOL_ENABLED=false` 可能被封，属预期，记下来）
- `playwright` —— 动态页，看是否有 chromium 启动日志、是否 OOM（worker 内存）
- `announcement` —— sse/szse/cninfo；**已知 SSE smoke 不稳定**（handoff），szse/cninfo 预期可抓
- `quotes` —— **默认 disabled**，本轮不抓；全链路阶段再 admin 启用

> 抓取成功的判据：`items` 表有新行（`items.fetched_at` 为抓取时间）+ 日志 `fetch succeeded count>0`。下游 prefilter 报 LLM 错是预期的（未配 Qwen），**不影响 fetch 结论**。

---

## 5.1 故障：抓取成功但页面一条数据都没有（高频踩坑，2026-06-16 实战）

**现象**：worker 日志 `fetch succeeded count=30`、`items` 表有数据，但 web 时间线空空如也。极易误判成"抓取失败"，其实抓取是好的。

**根因因果链（无 LLM → 无 scoredAt → 页面空）**：

1. 时间线只显示 **`item_analysis.scored_at IS NOT NULL`** 的 item —— 这是硬条件，见 `apps/web/lib/api/timeline-query.ts` 的 `visibleItemConditions`（`isNotNull(itemAnalysis.scoredAt)`）。
2. `scored_at` 由流水线 **scorer 段**（调 **DeepSeek**）写入，见 `apps/worker/src/handlers/scorer.ts`。
3. fetch 写入 item 后入 6 段 flow（`apps/worker/src/flows.ts`），执行顺序：
   `prefilter(Qwen) → ner(Qwen) → scorer(DeepSeek) → embedder → cluster → curator`。
4. **没配 LLM**（缺 `QWEN_BASE_URL` / `DEEPSEEK_API_KEY`）时，第一段 prefilter 就连不上 Qwen（默认回退 `http://localhost:8001/v1`）→ job 抛错重试到死 → **永远到不了 scorer** → `scored_at` 恒为 null → **页面恒空**，与 fetch 抓到多少条无关。

**一句话**：fetch 成功是必要不充分条件；**页面出数据 = 流水线跑到 scorer = Qwen + DeepSeek 都可达**。

**确诊 SQL**（抓到了但没评分 = 这个病）：

```bash
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c \
 "SELECT count(*) AS total, count(ia.scored_at) AS scored \
  FROM items i LEFT JOIN item_analysis ia ON ia.item_id=i.id;"
# total>0 且 scored=0 → 实锤：抓取 OK，流水线没跑（多半是没配 LLM 或 LLM 不可达）
```

**修复**：

1. Portainer stack environment 填 **`QWEN_BASE_URL`**（内网 Qwen，如 `http://10.10.x.x:8001/v1`）+ **`DEEPSEEK_API_KEY`**；LLM env 只需挂在 **worker** 服务（scheduler/web 不需要）。`KIMI_API_KEY` 只影响日报，可暂缺。
2. ⚠ **最大暗坑：DeepSeek 默认走公网 `api.deepseek.com`，内网出口未必可达**（与 jiemian/yicai 抓取超时同源）。配完务必在 worker 容器内验证：
   ```bash
   curl -sS -m8 -o/dev/null -w "qwen:%{http_code}\n" "$QWEN_BASE_URL/models"
   curl -sS -m8 -o/dev/null -w "deepseek:%{http_code}\n" https://api.deepseek.com
   ```
   不可达就把 `DEEPSEEK_BASE_URL` 指向内网网关/代理，否则 scorer 照样失败、页面照样空。
3. 配好后等一个抓取周期，再跑上面确诊 SQL，`scored>0` 即恢复。

> 想"先验证抓取、暂不上 LLM"也行——但要清楚这种状态下**页面本就该是空的**，验证只能靠 §5 的 SQL/日志，不能靠看页面。

---

## 6. 全链路 + 生产硬化（首测通过后再做）

- **切回 secret 方案（G1 已修）**：entrypoint 已能读 `*_FILE`，正式部署时按 `deploy/README.md` 用 `docker secret create` 建好 9 个 secret，stack.yml 原生的 `*_FILE` + `secrets:` 段即可直接生效（无需改回纯 env）。
- **LLM**：在 Portainer stack environment 设置 `QWEN_BASE_URL=http://<qwen-host>:8001/v1`（按真实内网地址替换）+ 建好 `deepseek_api_key` / `kimi_api_key` secrets，跑通 prefilter→评分→聚类→curator。
- **MinIO 桶 + lifecycle**：用 backup 镜像内置 provisioning 脚本幂等初始化：
  ```bash
  docker run --rm --network fe-radar_internal \
    --entrypoint /scripts/minio-provision.sh \
    -e MINIO_ENDPOINT='http://minio:9000' \
    -e MINIO_ACCESS_KEY='<minio-user>' \
    -e MINIO_SECRET_KEY='<minio-password>' \
    -e BRIEFING_MINIO_BUCKET='fe-radar-briefings' \
    -e BACKUP_MINIO_BUCKET='fe-radar-backups' \
    -e BRIEFING_RETENTION_DAYS=90 \
    harborssl.fegroup.cn/custom-project/fe-radar-backup:latest
  ```
  验收输出必须包含 `briefing-docx-retention`，否则不要启用 v1.1 简报。
- **Grafana**：生产 stack 通过 Swarm configs 挂载 `deploy/grafana` provisioning；Portainer env 必须设置 `GRAFANA_DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?...`，并确认 datasource UID 为 `fe-radar-postgres`。
- **auth**：`DINGTALK_ENABLED=true` 上钉钉 SSO 时，本地登录默认关闭；应急才设 `EMERGENCY_LOCAL_LOGIN=true`（Gate 2 #1）。
- **quotes 信源**：adapter 上线后 admin 后台逐个 `enabled=true` 并验证（NFR-102 数值不过 LLM）。
- **代理池**：T1 政府站需要，配 `proxy_list` 后 `PROXY_POOL_ENABLED=true`（详见 §7.1）。

---

## 7. 信源能力通电（住宅代理 / Firecrawl）— 零代码，纯运维

> 背景：2026-06-17 信源抓取可行性复核结论 = **不缺架构缺通电**。代理池与 Firecrawl 发现层代码均已就绪并接入 dispatch，仅靠部署侧配置即可激活。本节两步互相独立，可分别落地。
> 任务卡：`spec/source-fetch-optimization/tasks.md` T-SRC-01。

### 7.1 住宅代理通电（救机房 IP 403 簇）

**解决对象**：被机房 IP 段封锁的源——发改委、工信部、中电联、中国能源报（`paper.people.com.cn` 403）等。基建见 `apps/worker/src/lib/proxy-pool.ts`，已接入 `fetchers/http.ts` 与 `playwright.ts`。

**步骤**：

```bash
# 1) 采购住宅代理，拿到 host:port 列表（支持 http/https/socks，可带账密）
#    写成每行一个代理的清单（# 开头为注释）：
docker secret create proxy_list <(printf 'http://user:pass@res1.example.com:8000\nhttp://user:pass@res2.example.com:8000\n')

# 2) stack environment 打开开关（PROXY_LIST_FILE=/run/secrets/proxy_list 已在 stack.yml 配好）
#    PROXY_POOL_ENABLED: "true"
# 3) 重部署 worker 服务
```

**重新启用之前因 403 禁用的源**（代理不会自动重启已禁用源）：admin 后台把发改委 / 工信部 / 中电联 / 中国能源报 `enabled=true`，或 SQL：

```sql
UPDATE sources SET enabled = true, fail_count = 0, last_error = NULL
WHERE name IN ('国家发改委','工信部','中电联','中国能源报');
```

**验收**（等一轮抓取后）：

```sql
-- 这些源应 fail_count 归零、last_ok_at 刷新到本轮
SELECT name, enabled, fail_count, last_ok_at, last_error FROM sources
WHERE name IN ('国家发改委','工信部','中电联','中国能源报') ORDER BY name;
```

**rollback**：stack env `PROXY_POOL_ENABLED=false` → 重部署 worker。代码在关闭时自动 bypass 代理（`proxy-pool.ts` `acquire()` 直接返回 undefined），无副作用。

> **⚠️ 合规底线**：代理**仅用于绕 IP 封禁**。雪球（robots `/k`）、搜狗微信（robots `/weixin`，电缆头条/储能头条）、索比光伏（robots `/news/`）因 robots.txt 被禁用，**不得借代理重启**——`assertRobotsAllowed` 会照样拦截，强行绕过违反项目合规约束。

### 7.2 Firecrawl C1 风险检索通电（发现层 + 诉讼监测）

**作用**：SERP 式搜索「远东 诉讼/行政处罚/事故」等关键词，补回裁判文书网等抓不到的风险信号（合规替代路径）。代码见 `fetchers/crawl/firecrawl-client.ts` + `handlers/fetch.ts` `case 'crawl'`；源 `Firecrawl-C1风险检索` 由迁移 0024 置 `enabled=true`。

**步骤**：

```bash
# 1) 获取 Firecrawl API key（fc-xxx）
# 2) 建 secret（stack.yml 已配 FIRECRAWL_API_KEY_FILE=/run/secrets/firecrawl_api_key）
docker secret create firecrawl_api_key <(printf 'fc-xxx')
# 3) 确认源已启用（迁移 0024 已置 true；若被 admin 关过则重开）
# 4) 重部署 worker → 等一轮抓取（crawl 走新闻 cron 0 */6 * * *）
```

**验收**：

```sql
-- 应出现来自 Firecrawl 源的入库条目，且该源 fail_count=0 / last_ok_at 刷新
SELECT s.name, s.fail_count, s.last_ok_at,
       count(i.id) FILTER (WHERE i.fetched_at > now() - interval '24 hours') AS items_24h
FROM sources s LEFT JOIN items i ON i.source_id = s.id
WHERE s.name = 'Firecrawl-C1风险检索' GROUP BY s.id, s.name, s.fail_count, s.last_ok_at;
```

**rollback**：admin 后台把该源 `enabled=false`（或 SQL 同理）。

> **注意**：未配 key 时该源抓取必然失败（`SourceFetchError FETCH_CONFIG`），`fail_count` 递增属预期；配好 key 后恢复正常。该源不影响其它源抓取。

---

## 已完成 / 仍需你做

**已在仓库修好（本轮）**：

- G1 `*_FILE` 密钥注入（`deploy/docker-entrypoint-secrets.sh` + 两个镜像 ENTRYPOINT）
- G2 一次性迁移镜像（`deploy/Dockerfile.migrate`）
- G6 stack.yml worker/scheduler command 路径

**仍需你做（部署侧）**：

1. 在 build server 上手工 `docker build` / `docker push` 5 个自建镜像（§1.1；本机无 Docker 未自测，留意首次构建）
2. 按 §3 贴精简 stack（纯 env）→ Portainer 部署 → §4 跑 migrate + seed:admin
3. §5 等一轮抓取后用 SQL/日志核对 5 类信源
4. 把抓取结果（`items` 计数 + `sources.last_error`）贴回来，我帮你判读哪些源 OK / 哪些要配代理或修适配器

> 全链路（评分/简报/钉钉）所需的 Qwen 端点、DeepSeek/Kimi key、MinIO 桶在 §6，待 fetch 验证通过后再上。
