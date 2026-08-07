# 钉钉群卡片内免登实施任务

状态：Deployed → Human UAT

日期：2026-08-06

## T-DIA-01 安全回跳与 middleware 分流

- status: **done**
- goal: 无会话时保留完整深链，并仅在钉钉客户端进入免登入口。
- constraints: 不改变 API 401、RBAC、已登录请求和 `/auth/**`；callbackUrl 只能是本站相对路径。
- ask_agent_first: 先读 `middleware.ts`、现有 middleware 测试和 Auth.js redirect callback，再修改。
- owner: Grok CLI
- scope: `apps/web/middleware.ts`、`apps/web/lib/auth/safe-callback-url.ts`、对应测试。
- rollback: 回退 middleware/helper；未触及数据。
- acceptance: `/daily?date=...` 查询参数保留；DingTalk UA 与普通浏览器分流正确；恶意回跳被拒绝。

## T-DIA-02 钉钉内免登 Provider

- status: **done**
- goal: 以一次性免登码取得企业用户并交给现有 Auth.js 签发 Cookie。
- constraints: 必须经 `mergeOrCreateUser()`；共享合并入口必须拒绝已停用的同 unionid 用户，使扫码与免登行为一致；只取 unionid/name/dept；不打印 code/token/secret；不自建 Cookie/JWT。
- ask_agent_first: 核对官方企业内部应用免登 API、现有 `DingtalkProvider` 和 `mergeOrCreateUser()` 返回形状。
- owner: Grok CLI
- scope: `apps/web/lib/auth/dingtalk-inapp-provider.ts`、`apps/web/lib/auth/merge.ts`、`apps/web/auth.ts`、单元测试。
- rollback: 移除新增 provider；现有二维码 provider 保持可用。
- acceptance: token 缓存（含 5min 缓冲 + 并发 inflight）、三段 API 错误、用户字段校验、停用账号拒绝、账号合并和 Auth.js user 映射均有测试。

## T-DIA-03 免登页面与 SDK

- status: **done**
- goal: 在钉钉 H5 容器内自动请求免登码并登录，失败时可退回扫码登录。
- constraints: 使用官方锁版本 `dingtalk-jsapi@3.2.9`；不重复提交一次性 code；页面可访问且不被 middleware 循环拦截。
- ask_agent_first: 核对当前 React 19/Next.js 15 客户端组件和 `signIn()` 使用方式。
- owner: Grok CLI
- scope: `apps/web/app/auth/dingtalk/auto/**`、web 依赖与最小测试。
- rollback: 删除免登页和 SDK 依赖；middleware 回到二维码入口。
- acceptance: 成功调用 `signIn("dingtalk-inapp")` 并保留 callbackUrl；失败态可重试 + 二维码兜底。

## T-DIA-04 验证、评审与部署

- status: **deployed (human UAT pending)**
- goal: 独立审查安全边界并给出可执行的生产配置和真机验收清单。
- constraints: 当前混合工作区仅精确提交本批认证文件；不输出生产 secret。
- ask_agent_first: Grok 完成后由 Codex 主会话逐文件审查，不能只接受实现器自述。
- owner: Codex
- scope: 定向 Vitest、web typecheck/lint、`git diff --check`、认证代码评审、runbook。
- rollback: 将 web 镜像回退到部署前 digest `sha256:55747ad3a4df49fe1d7b2518c1b7d5cc820a32b69a02ef76f12910367a88d7f3`。
- acceptance: 无 Critical/High 未决发现；定向测试和认证范围 typecheck 通过；Portainer 构建、部署及 HTTP 冒烟通过；最终上线结论仍需实际钉钉客户端验收。
- note: 2026-08-06 Grok CLI 完成实现；Codex 独立评审后修复锁文件噪声、补 middleware/JSAPI 测试并收紧超时与输入校验。最终定向 vitest 54/54、相关 eslint 0、认证范围 `tsc` 0、`git diff --check` 0。全量 web typecheck 仍被既有无关 `lib/api/alerts-query.ts:62` 语法错误阻断。认证代码以 commit `ebd6a4f` 推送，在 Portainer 主机直接构建并部署镜像 digest `sha256:a0de3b0e6c5e744d963d731a300822637d9e57c06686b8e63668a2fe9587b9ad`；web 容器运行、零重启，外部浏览器/钉钉 UA 分流及 provider 注册冒烟通过。
