# 钉钉群卡片内免登设计

状态：Implemented（待生产配置与真机验收）

日期：2026-08-06

## 设计原则

只补“钉钉内免登入口”，复用现有 Auth.js、`mergeOrCreateUser()`、middleware 和卡片直链。不开新会话表，不把用户信息或 token 放进卡片 URL，不改现有二维码 Provider。

## 流程

1. ActionCard 继续链接 `/daily?...` 或 `/briefing/[id]`。
2. middleware 发现无 FE-Radar Cookie：
   - DingTalk User-Agent：跳 `/auth/dingtalk/auto?callbackUrl=<pathname+query>`；
   - 其他环境：跳现有 `/auth/login?callbackUrl=<pathname+query>`。
3. 免登页调用官方 `dingtalk-jsapi` 的 `dd.runtime.permission.requestAuthCode({ corpId })`。
4. 客户端调用 `signIn("dingtalk-inapp", { code, callbackUrl })`。
5. `dingtalk-inapp` Credentials provider 在服务端：
   - `POST https://api.dingtalk.com/v1.0/oauth2/accessToken` 获取应用 token；
   - `POST https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=...` 以一次性 code 换 userId；
   - `POST https://oapi.dingtalk.com/topapi/v2/user/get?access_token=...` 获取 `unionid` 与 `name`；
   - 调用 `mergeOrCreateUser({ unionid, name, dept: null })`；
   - `mergeOrCreateUser()` 对已停用的同 unionid 账号显式拒绝，扫码与免登共用该防线；
   - 返回 Auth.js user，由现有 JWT/session callbacks 签发 Cookie。
6. Auth.js 按安全回跳地址返回原日报或简报。

## 文件边界

- `apps/web/lib/auth/dingtalk-inapp-provider.ts`：钉钉 API 客户端、token 缓存（5 分钟缓冲 + 并发 inflight）、Credentials provider。
- `apps/web/lib/auth/merge.ts`：在共享合并入口拒绝已停用的同 unionid 用户。
- `apps/web/lib/auth/safe-callback-url.ts`：同源相对回跳地址校验；middleware 与免登页共用。
- `apps/web/app/auth/dingtalk/auto/page.tsx`：读取服务端配置并渲染免登状态页。
- `apps/web/app/auth/dingtalk/auto/auto-login.tsx`：调用 JSAPI 与 `signIn()`。
- `apps/web/auth.ts`：注册 `dingtalk-inapp` provider，不改变现有 `dingtalk` provider。
- `apps/web/middleware.ts`：保留 query；钉钉 UA 路由至免登入口。
- `apps/web/package.json` / `pnpm-lock.yaml`：使用官方 `dingtalk-jsapi`，不手写或远程注入未锁版本 SDK。
- `docs/runbook/deploy-portainer.md`：登记钉钉 H5 应用首页/安全域名、CorpId 和真机验收步骤。

## 安全与失败处理

- `callbackUrl` 规范化为以单个 `/` 开头的本站路径；无效值回退 `/`。
- AppSecret 只从服务端环境变量读取；API URL、请求体和错误日志不输出 code/token/secret。
- 钉钉 fetch 使用 10 秒超时；非 2xx、`errcode != 0`、缺少 userId/unionid/name 均拒绝登录。
- 应用 token 缓存预留 5 分钟过期缓冲；失败不缓存。
- JSAPI 失败页提供“使用钉钉扫码登录”链接，不自动反复调用同一个 code。
- middleware 不拦 `/auth/**`，防止重定向循环。

## 已知部署前提

- FE-Radar 必须登记为集团企业内部 H5 应用，并配置应用首页和安全域名。
- 手机/桌面钉钉必须能访问 FE-Radar 内网地址；代码不能替代内网路由、Wi-Fi 或 VPN。
- 首次生产验收必须覆盖钉钉 Android/iOS/Windows 或实际使用的平台，以及外部浏览器二维码兜底。
