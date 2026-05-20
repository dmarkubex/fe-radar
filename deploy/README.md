# FE-Radar Deployment

## Images

Build the Postgres image before deploying the stack:

```bash
docker build -f deploy/Dockerfile.postgres-zhparser -t fe-radar/postgres-zhparser:pg16 .
```

Build and publish `fe-radar/web:latest` and `fe-radar/worker:latest` from the monorepo CI pipeline.

## Secrets

Create Docker secrets before Portainer deploy:

```bash
printf '%s' '<db-password>' | docker secret create db_password -
printf '%s' '<nextauth-secret>' | docker secret create nextauth_secret -
printf '%s' '<dingtalk-secret>' | docker secret create dingtalk_app_secret -
printf '%s' '<deepseek-key>' | docker secret create deepseek_api_key -
printf '%s' '<kimi-key>' | docker secret create kimi_api_key -
printf '%s' '<minio-user>' | docker secret create minio_root_user -
printf '%s' '<minio-password>' | docker secret create minio_root_password -
printf '%s\n' '# host:port[:user:pass]' | docker secret create proxy_list -
```

## Verification

All services set `TZ=Asia/Shanghai`. After deployment, verify:

```bash
docker service ls
docker exec <postgres-container> psql -U fe_radar -d fe_radar -c "SELECT to_tsvector('zhparser', '电力电缆');"
docker exec <web-container> date
```

## v1.1 RSSHub 运维说明

### 概述

`rsshub` 服务（`diygod/rsshub`）为 v1.1 commodity-briefing 模块的 `rsshub-extract` adapter 提供 RSS feed。该服务仅挂载内网 overlay（`internal: true`），**不向主机映射任何端口**，只能由同一 swarm stack 内的 worker 容器通过服务名访问。

### 端口与访问

- 容器内监听端口：`1200`
- 内网访问地址：`http://rsshub:1200`（worker 通过环境变量 `RSSHUB_BASE_URL=http://rsshub:1200` 注入）
- 主机层面**无端口暴露**

### 健康检查

healthcheck 每 30 秒执行一次 `curl -f http://localhost:1200/healthz`，连续 3 次失败后容器标记为 unhealthy，Swarm restart_policy（condition: any）自动重启。

手工验证（在 worker 容器内执行）：

```bash
curl http://rsshub:1200/healthz
# 期望响应：{"status":"ok"} 或 HTTP 200
curl http://rsshub:1200/smm/news/cu
# 期望响应：RSS XML，含 <channel> 标签
```

### 重启策略

`restart_policy: condition: any` — 容器因任何原因退出（包括正常退出）都会自动重启。

### 镜像版本管理

当前 pin 到 `diygod/rsshub@sha256:0d40e1c9e5c3811da2c4eeaf7443e1bcdc6d7dc5510aa3df98bab0f979c03059`（对应 2026-05-14 镜像）。**升级步骤**：

```bash
# 1. 在 build server 上拉取目标 tag
docker pull diygod/rsshub:<new-tag>
# 2. 获取 digest（推荐用 digest 替换 tag 以防镜像漂移）
docker inspect --format='{{index .RepoDigests 0}}' diygod/rsshub:<new-tag>
# 3. 将 deploy/stack.yml 中 rsshub.image 更新为 sha256 digest 形式
#    例：diygod/rsshub@sha256:abc123...
# 4. docker stack deploy -c deploy/stack.yml fe-radar
```

### Redis 缓存

rsshub 通过环境变量 `REDIS_URL=redis://redis:6379` 接入 v1.0 已有的 `redis` 服务，缓存过期时间 `CACHE_EXPIRE=3600`（秒）。无需额外配置。

### 资源配额

- 内存上限：256 MB
- CPU 上限：0.10 核

如频繁 OOM，可在 stack.yml `rsshub.deploy.resources.limits.memory` 调整（建议不超过 512 MB）。
