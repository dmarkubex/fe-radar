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
