# FE-Radar 外网 HTTPS 部署方案

> 状态：执行方案，尚未切换生产入口。实际实施前必须确定外网域名、证书来源和访问控制策略。

## 1. 目标与边界

FE-Radar 对外提供服务时必须使用 HTTPS。推荐由 Nginx 终止 TLS，Nginx 到 Web 容器继续使用受控内网 HTTP，不在 Next.js 容器内维护证书。

本方案只覆盖 FE-Radar Web 入口：

- 浏览器只访问 `https://<FE_RADAR_DOMAIN>`。
- `http://<FE_RADAR_DOMAIN>` 永久跳转 HTTPS。
- Web 容器的 `3000` 端口不直接暴露公网。
- Postgres、Redis、MinIO、RSSHub、Worker 和 Scheduler 继续只在内部网络访问。
- 推荐使用独立子域名根路径，例如 `https://radar.example.com/`，不使用 `/fe-radar/` 二级路径。

FE-Radar 原设计是内网系统。若入口位于公网，应同时使用企业 VPN、零信任网关或来源 IP 白名单；仅增加 TLS 不能替代访问控制。

## 2. 推荐拓扑

```text
Internet / DingTalk
        |
        | HTTPS 443
        v
Nginx / WAF / Zero Trust
        |
        | HTTP，受控内网或 Docker 网络
        v
FE-Radar Web :3000
        |
        +---- Postgres / Redis / MinIO（内部网络）
```

推荐端口策略：

1. Nginx 与应用同机、Docker Compose 部署：Web 只绑定 `127.0.0.1:3013:3000`。
2. Nginx 与应用同一 Docker 网络：删除 Web 的主机端口映射，Nginx 代理 `http://web:3000`。
3. Nginx 位于独立服务器：防火墙只允许 Nginx IP 访问 Web 发布端口。

## 3. 上线前置条件

- 独立域名已完成 DNS 解析，建议切换前将 TTL 降至 300 秒。
- 已取得受浏览器和钉钉客户端信任的 TLS 证书，并配置自动续期。
- 外网访问边界已经确认：VPN、零信任、IP 白名单至少启用一种。
- Portainer 当前 stack 已备份，当前 Web 镜像 ID 和 RepoDigest 已记录。
- 钉钉开放平台有权限修改应用首页、安全域名和 OAuth 回调地址。
- 生产 `NEXTAUTH_SECRET` 保持不变，切换 HTTPS 时不得重新生成，否则现有会话全部失效。

## 4. Nginx 配置

将域名、证书路径和 upstream 地址替换为生产值：

```nginx
server {
    listen 80;
    server_name radar.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name radar.example.com;

    ssl_certificate     /etc/nginx/tls/fullchain.pem;
    ssl_certificate_key /etc/nginx/tls/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3013;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Port 443;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_connect_timeout 10s;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

应用已经在生产模式返回 HSTS、CSP、`X-Content-Type-Options` 等响应头。Nginx 不需要重复覆盖这些响应头，但不能过滤应用返回的 `Strict-Transport-Security`。

## 5. Portainer / 应用配置

Web 服务必须设置：

```yaml
environment:
  NEXTAUTH_URL: https://radar.example.com
  AUTH_TRUST_HOST: "true"
```

注意事项：

- `NEXTAUTH_URL` 必须与浏览器实际访问源完全一致，包含 `https://`，不带末尾 `/`。
- 应用依据该值启用 `Secure` Session Cookie；保留 HTTP 值会导致 HTTPS 登录状态异常或降级。
- `AUTH_TRUST_HOST=true` 允许 Auth.js 接受反向代理转发的真实 Host。
- 外网运行时删除或设为 `false`：`EMERGENCY_LOCAL_LOGIN`。仅 SSO 故障处置期间临时开启。
- `NEXTAUTH_SECRET`、钉钉 AppSecret 等密钥继续由 Portainer 环境或 Docker secret 提供，不写入 Git。
- 若 MiroFish 也对用户开放，其 `MIROFISH_WEB_BASE_URL` 和公开 API 地址必须分别切换到 HTTPS 入口；容器间 `MIROFISH_API_BASE_URL=http://mirofish:5001` 保持不变。

仓库正式执行外网切换时，应将 `deploy/stack.yml` 中固定的 HTTP `NEXTAUTH_URL` 改为 Portainer 必填变量，避免后续重新部署退回 HTTP：

```yaml
NEXTAUTH_URL: ${NEXTAUTH_URL:?set NEXTAUTH_URL to the public HTTPS origin}
AUTH_TRUST_HOST: "true"
```

## 6. 钉钉配置同步

在钉钉开放平台同步修改：

```text
应用首页：https://radar.example.com/
安全域名：radar.example.com
OAuth 回调：https://radar.example.com/api/auth/callback/dingtalk
```

同时在 FE-Radar 管理端更新合并日报推送配置中的 `baseUrl`：

```text
https://radar.example.com
```

否则钉钉 ActionCard 中的日报和每日简报按钮仍会生成 HTTP 或旧内网地址。

## 7. 实施顺序

1. 备份 Portainer stack 配置，记录当前 Web 容器镜像 ID、RepoDigest、状态和最近错误日志。
2. 配置证书和 Nginx，但暂不修改正式 DNS。
3. 使用临时 hosts 或灰度域名验证 HTTPS upstream、登录和静态资源。
4. 在钉钉开放平台增加新安全域名、应用首页和回调地址。
5. 设置 Portainer `NEXTAUTH_URL=https://<domain>` 和 `AUTH_TRUST_HOST=true`，重建 Web 容器。
6. 更新合并日报推送 `baseUrl`，执行一次测试推送。
7. 切换正式 DNS，确认 HTTP 只返回 HTTPS 跳转。
8. 连续观察登录、钉钉回调、5xx、重定向和容器重启至少 30 分钟。
9. 验收通过后，关闭 Web 端口的公网直接访问。

## 8. 验收清单

### HTTP 与 TLS

```bash
curl -I http://radar.example.com/
curl -I https://radar.example.com/
curl -I https://radar.example.com/api/auth/csrf
```

验收要求：

- HTTP 返回 `301` 或 `308`，`Location` 指向同路径 HTTPS。
- HTTPS 证书域名、证书链和有效期正确，无浏览器警告。
- HTTPS 响应包含 `Strict-Transport-Security`。
- 页面、静态资源和 API 不产生 Mixed Content。
- 登录过程中所有跳转、`redirect_uri` 和回调均为 HTTPS。
- 登录成功后的 `fe-radar.session-token` Cookie 包含 `HttpOnly`、`SameSite=Lax`、`Secure`。

### 产品路径

- 外部 Chrome 未登录打开日报深链，进入钉钉扫码登录并能返回原日期。
- 手机钉钉打开日报和每日简报 ActionCard，免登成功且日期不丢失。
- 管理员页面、日报、每日简报、下载和搜索均能访问。
- Web 容器 `restartCount=0`，最近日志没有持续 `CallbackRouteError`、重定向循环或 5xx。
- 公网无法直接访问 Web 原始端口、Postgres、Redis、MinIO 和 RSSHub。

## 9. 回滚方案

满足任一条件立即回滚：登录回调失败、循环重定向、Cookie 无法保持、钉钉免登失败、持续 5xx 或 Web 容器反复重启。

回滚步骤：

1. DNS 或 Nginx 恢复到原入口，保留原路径和查询参数。
2. Portainer 将 `NEXTAUTH_URL` 恢复到切换前值，强制重建 Web 容器。
3. 若问题来自新 Web 镜像，将 Web 服务回退到上线前记录的 RepoDigest。
4. 钉钉应用首页、回调地址和 ActionCard `baseUrl` 恢复旧值。
5. 验证旧入口登录、日报和简报恢复，再分析失败层级。

回滚不得修改数据库、重新生成 `NEXTAUTH_SECRET`，也不需要回退 Worker、Scheduler 或迁移容器。
