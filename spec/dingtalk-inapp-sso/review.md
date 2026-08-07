# 钉钉群卡片内免登代码评审

日期：2026-08-06

结论：**APPROVE（代码与部署冒烟）**；生产状态为 **Human UAT Pending**。

## 评审范围

- Auth.js provider 注册、企业应用 token 缓存和三段钉钉 API 调用。
- `mergeOrCreateUser()` 停用账号统一拒绝。
- middleware 的 DingTalk UA 分流、完整深链保留和 `/auth/**` 防循环。
- H5 JSAPI 自动登录、失败重试与二维码兜底。
- SDK 依赖、测试、Portainer/钉钉后台 runbook。

实施器为 Grok CLI；评审与复验由 Codex 主会话独立完成。

## 已修复发现

1. **MEDIUM — lockfile 大范围格式噪声**：将 `pnpm-lock.yaml` 从数千行无关变化压缩为新增 SDK 及其传递依赖的最小差异。
2. **MEDIUM — 新 middleware 分流缺少真实分支测试**：补充钉钉 UA、外部浏览器、query 保留和 `/auth/**` 防循环测试。
3. **MEDIUM — fetch 超时只覆盖响应头**：改用 `AbortSignal.timeout(10_000)`，让响应体读取也受同一超时信号约束。
4. **LOW — 空白 code 与不确定 signIn 结果**：code 先 `trim()`；`signIn()` 未明确成功时进入失败态，避免回跳循环。
5. **LOW — JSAPI 边界无直接测试**：提取纯 TypeScript 适配函数，覆盖 `dd.ready`、成功 code 与失败回调。

## 验证证据

- 定向 Vitest：5 files / 54 tests passed。
- 相关 ESLint：0 error / 0 warning。
- 认证范围隔离 TypeScript：0 error。
- `git diff --check`：0 error。
- 全量 web typecheck：被本任务之前已存在的 `apps/web/lib/api/alerts-query.ts:62` 语法错误阻断；未修改该文件。

## 部署证据

- commit：`ebd6a4f`，已推送 `origin/master`。
- Portainer 主机直接构建；生产 digest：`sha256:a0de3b0e6c5e744d963d731a300822637d9e57c06686b8e63668a2fe9587b9ad`。
- Stack 更新 HTTP 200；web 容器 Running、restartCount=0；部署后日志无 error-like 行。
- 外部 Chrome UA 跳转二维码登录；DingTalk UA 跳转免登入口；两者均保留完整 callbackUrl；免登页 HTTP 200；Auth.js 已注册 `dingtalk-inapp` provider。

## 剩余关卡

- 在实际 Android/iOS/桌面钉钉验证日报与简报深链可免扫码打开。
- 验证停用账号在扫码与免登两条路径均被拒绝。
- 若真机失败，优先核对钉钉开放平台 H5 安全域名、应用可见范围、CorpId 和客户端到内网地址的连通性。
