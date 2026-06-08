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
| **G3** | **Qwen/LLM 未配置**                           | worker **能正常启动**（`createQwenClient()` 缺 env 用默认值不抛错），fetch 阶段照常抓取写 `items`；下游 prefilter/NER/评分调用 LLM 时才失败。                        | ⏳ **fetch 验证不需要 LLM**；全链路再配 `QWEN_BASE_URL` + DeepSeek/Kimi key（§6）。                                                                             |
| G4     | MinIO bucket 不自动建                         | 简报/备份需要 `fe-radar-briefings`/`fe-radar-backups`，fetch 测试不需要                                                                                              | ⏳ 全链路阶段用 `mc mb` 建桶（§6）                                                                                                                              |
| G5     | `DB_PASSWORD` 双重身份                        | DATABASE_URL 里 `${DB_PASSWORD}` 是 **stack 部署期变量**（非 secret 文件）；postgres 自己读 `db_password` secret                                                     | ℹ️ 部署时在 Portainer stack environment 设 `DB_PASSWORD`，与 postgres 密码一致（§3）                                                                            |

> **结论**：阻塞性缺口 G1/G2/G6 已在仓库修好；首部署按下文走即可。注意这些镜像/脚本因本机无 Docker **未做构建自测**，请在 build server 首次构建时留意。

---

## 1. 前置：镜像全部走内网 Harbor `harborssl.fegroup.cn/custom-project`

stack.yml 与 compose.fetch-smoke.yml 的 **所有 image 已改为 Harbor 路径**。你把 compose 贴进 Portainer 前，需保证 Harbor 里有这些镜像、且 Portainer/Docker 主机能登录 Harbor 拉取。

**1.1 构建并推送 4 个自建镜像**（在有 Docker 的构建机，仓库根目录）：

```bash
docker login harborssl.fegroup.cn        # 先登录 Harbor

R=harborssl.fegroup.cn/custom-project
docker build -f deploy/Dockerfile.postgres-zhparser -t $R/fe-radar/postgres-zhparser:pg16 .
docker build -f deploy/Dockerfile.worker  -t $R/fe-radar/worker:latest  .
docker build -f deploy/Dockerfile.migrate -t $R/fe-radar/migrate:latest .
docker build -f deploy/Dockerfile.web     -t $R/fe-radar/web:latest     .   # web 首测可不上
docker push $R/fe-radar/postgres-zhparser:pg16
docker push $R/fe-radar/worker:latest
docker push $R/fe-radar/migrate:latest
docker push $R/fe-radar/web:latest
```

**1.2 公共镜像也需进 Harbor**（内网拉不到 Docker Hub）：把 redis / rsshub（含 minio/grafana，全链路才用）镜像同步到 `custom-project`。例如：

```bash
docker pull redis:7-alpine && docker tag redis:7-alpine $R/redis:7-alpine && docker push $R/redis:7-alpine
docker pull diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059 \
  && docker tag diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059 $R/diygod/rsshub:pinned \
  && docker push $R/diygod/rsshub:pinned
# 全链路再同步 minio/minio、grafana/grafana
```

> ⚠️ **两点须核对**：
>
> 1. **leaf 仓库名**——我按"原 repo 路径前面加 `harborssl.fegroup.cn/custom-project/`"机械改的（如 `custom-project/minio/minio`、`custom-project/redis`）。**如果你 Harbor 里实际 push 的名字不同**（比如扁平成 `custom-project/redis` 已对、但 rsshub 你可能 push 成别的 tag），请按实际改 compose 里那几行 image。
> 2. **rsshub 用 digest**：`@sha256:...` 只有在 Harbor 里是**同一 manifest**时才有效；若你 push 时 digest 变了，把 compose 里 rsshub 改成你 Harbor 的 tag（如上例 `$R/diygod/rsshub:pinned`）。
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
4. **Deploy the stack**，等 `postgres`/`redis`/`worker`/`scheduler`/`rsshub` 起来（Portainer 里看 service 状态 = running）。

> 生产正式部署再走 secret 方案（§6），首测以「能抓到」为先。

---

## 4. 迁移 + seed（关键，G2）

用 §1 构建好的 `fe-radar/migrate:latest` 一次性镜像（已含 tsx + db 脚本），在能连 `internal` overlay 的 manager 节点执行：

```bash
# 1) 建表 + seed ~75 个 enabled 信源
docker run --rm --network fe-radar_internal \
  -e DATABASE_URL='postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar' \
  fe-radar/migrate:latest

# 2) 建后台登录账号（可指定用户名/密码）
docker run --rm --network fe-radar_internal \
  -e DATABASE_URL='postgres://fe_radar:CHANGE_ME_DBPW@postgres:5432/fe_radar' \
  -e SEED_ADMIN_USERNAME=admin -e SEED_ADMIN_PASSWORD='<强密码>' \
  fe-radar/migrate:latest pnpm --filter @fe-radar/db seed:admin
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

---

## 5. 触发并观测 fetch 真连网验证

scheduler 默认每 6 小时整点调度一轮（`0 */6 * * *`）。要立刻测，手动入队一次调度任务（向 Redis 推 `schedule-fetch-sources`，或临时把 cron 改密；最简单是直接观测下一个整点，或在 worker 容器内用一段 tsx 触发）。**最省事**：等下一整点，或重启 scheduler 让它补一次（视实现）。

**观测抓取结果（不需要 LLM、不需要登录）**：

```bash
# 各信源最近抓取时间与失败计数
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c \
 "SELECT fetcher_type, name, last_fetched_at, fail_count, left(last_error,60) FROM sources WHERE enabled ORDER BY last_fetched_at DESC NULLS LAST LIMIT 30;"
# 真正抓到的条目数（按类型）
docker exec <postgres容器> psql -U fe_radar -d fe_radar -c \
 "SELECT s.fetcher_type, count(*) FROM items i JOIN sources s ON s.id=i.source_id GROUP BY 1 ORDER BY 2 DESC;"
# worker 日志（看 'fetch succeeded' / 'fetch failed' + correlationId）
docker service logs fe-radar_worker --since 10m | grep -E "fetch (succeeded|failed)|pipeline enqueued"
```

**按 5 类逐项核对**（对应之前讨论的抓取方式）：

- `rss` —— 经 rsshub，先确认 `curl http://rsshub:1200/healthz` ok（worker 容器内）
- `html` —— 政府/普通站；**注意**：T1 政府站需代理池（首测 `PROXY_POOL_ENABLED=false` 可能被封，属预期，记下来）
- `playwright` —— 动态页，看是否有 chromium 启动日志、是否 OOM（worker 内存）
- `announcement` —— sse/szse/cninfo；**已知 SSE smoke 不稳定**（handoff），szse/cninfo 预期可抓
- `quotes` —— **默认 disabled**，本轮不抓；全链路阶段再 admin 启用

> 抓取成功的判据：`items` 表有新行 + `sources.last_fetched_at` 更新 + 日志 `fetch succeeded count>0`。下游 prefilter 报 LLM 错是预期的（未配 Qwen），**不影响 fetch 结论**。

---

## 6. 全链路 + 生产硬化（首测通过后再做）

- **切回 secret 方案（G1 已修）**：entrypoint 已能读 `*_FILE`，正式部署时按 `deploy/README.md` 用 `docker secret create` 建好 9 个 secret，stack.yml 原生的 `*_FILE` + `secrets:` 段即可直接生效（无需改回纯 env）。
- **LLM**：配 `QWEN_BASE_URL`（本地 Qwen）+ `DEEPSEEK_API_KEY` + `KIMI_API_KEY`，跑通 prefilter→评分→聚类→curator。
- **MinIO 桶**：`mc mb fe-radar-briefings fe-radar-backups` + 90 天 lifecycle（简报/备份用）。
- **auth**：`DINGTALK_ENABLED=true` 上钉钉 SSO 时，本地登录默认关闭；应急才设 `EMERGENCY_LOCAL_LOGIN=true`（Gate 2 #1）。
- **quotes 信源**：adapter 上线后 admin 后台逐个 `enabled=true` 并验证（NFR-102 数值不过 LLM）。
- **代理池**：T1 政府站需要，配 `proxy_list` 后 `PROXY_POOL_ENABLED=true`。

---

## 已完成 / 仍需你做

**已在仓库修好（本轮）**：

- G1 `*_FILE` 密钥注入（`deploy/docker-entrypoint-secrets.sh` + 两个镜像 ENTRYPOINT）
- G2 一次性迁移镜像（`deploy/Dockerfile.migrate`）
- G6 stack.yml worker/scheduler command 路径

**仍需你做（部署侧）**：

1. 在 build server 上 `docker build` 4 个镜像（§1·B；本机无 Docker 未自测，留意首次构建）
2. 按 §3 贴精简 stack（纯 env）→ Portainer 部署 → §4 跑 migrate + seed:admin
3. §5 等一轮抓取后用 SQL/日志核对 5 类信源
4. 把抓取结果（`items` 计数 + `sources.last_error`）贴回来，我帮你判读哪些源 OK / 哪些要配代理或修适配器

> 全链路（评分/简报/钉钉）所需的 Qwen 端点、DeepSeek/Kimi key、MinIO 桶在 §6，待 fetch 验证通过后再上。
