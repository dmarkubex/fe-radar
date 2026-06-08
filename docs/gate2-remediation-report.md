# Gate 2 复评说明 — Antigravity REJECTED 7 findings 修复对照

> **致复评者（Codex）**：这是对 Antigravity Gate 2 评审（REJECTED · 3 Critical + 4 Major）的修复批次。请**对照真实代码逐条核验修复是否真正闭环**，而非看描述签字。每条下方列了「应做的对抗性核验」，请据此判定 CONFIRMED-FIXED / NOT-FIXED / REGRESSED。
>
> **复评范围**：`git diff fc23b0d..e4a7b29`（master..HEAD），修复批次为 5 个提交：
>
> | 提交                    | 覆盖 finding                              |
> | ----------------------- | ----------------------------------------- |
> | `1eaed33` `[T-SEC-FIX]` | #1 #2                                     |
> | `ce313c2` `[T-WK-FIX]`  | #3 #4(初版) #6                            |
> | `d9fee56` `[T-API-FIX]` | #5                                        |
> | `ad64fce` `[T-WEB-FIX]` | #7                                        |
> | `e4a7b29` `[T-WK-FIX]`  | **#4 复评 re-fix** + #3 Minor placeholder |
>
> **复评轮次 2 说明**：Codex 复评 REJECTED #4（连接泄漏未真正修完）。`ce313c2` 的 #4 初版
> 修对了显式建连的 3 处（FlowProducer / step0 / cluster），但漏了**工厂默认建连**的 2 处
> （`createFetchQueue()` / `createBriefingPushQueue(createRedisConnection())`）——BullMQ 对
> 传入的 IORedis 实例标记 `shared`，`Queue.close()` 不 quit 它。`e4a7b29` 已真正补齐并加测试。
>
> **基线验证**：`pnpm typecheck` 6 项目全 Done 0 error；`pnpm test` 482 passed / 0 failed（shared 8 · core 42 · db 54 · llm 27 · web 144 · worker 207）。

---

## #1 (Critical) — 本地登录无强制控制，仅靠文案

**原始 finding**：钉钉启用时仍公开「使用本地账号登录」并渲染 `<LocalLoginForm />`；`auth.ts` 始终注册 Credentials provider；"仅供运维应急"不是控制。

**修复**：

- `apps/web/lib/auth/dingtalk-provider.ts:22` 新增 `isLocalLoginAllowed()`：钉钉**未启用**→ `true`（M0–M3 唯一登录方式）；钉钉**启用**→ 仅当 `EMERGENCY_LOCAL_LOGIN==='true'` 才 `true`。
- `apps/web/auth.ts:30` `authorize()` 首行 `if (!isLocalLoginAllowed()) return null;` —— **真正的控制在 authorize 层**（拒绝凭据），不依赖 UI。
- `apps/web/app/auth/login/page.tsx` 计算并下传 `localLoginAllowed`；`login-panel.tsx` 仅在 `localLoginAllowed` 为真时渲染「使用本地账号登录 →」切换入口。
- 测试：`apps/web/lib/auth/__tests__/dingtalk-provider.test.ts`（4 例：钉钉关→允许 / 钉钉开+无 flag→拒 / 钉钉开+flag→允许 / 非 'true' 值→拒）。

**对抗性核验**：

1. 确认即便绕过 UI 直接 POST `/api/auth/callback/credentials`，钉钉启用且无 flag 时 `authorize` 返回 null（控制在服务端而非前端）。
2. 确认 `EMERGENCY_LOCAL_LOGIN` 只接受字面 `'true'`，其它值（`1`/`yes`）仍锁定。
3. 部署注意：新增 env `EMERGENCY_LOCAL_LOGIN`，生产默认不设。

---

## #2 (Critical) — Pino redact 缺 webhook/sign，且 MODULE_REDACT 未接线

**原始 finding**：`logger.ts` REDACT_PATHS 无 `webhook_url`/`sign_secret`；`dingtalk-bot.ts` 定义了 `DINGTALK_REDACT_PATHS` 但 `createLogger()` 未传入；测试只测常量。

**修复**：

- `packages/shared/src/logger.ts:16` REDACT_PATHS 增 `webhookUrl/signSecret/webhook_url/sign_secret/webhook/sign`（camelCase + snake_case 双写）。
- `logger.ts:29,31,47,51` `createLogger` 新增 `redactPaths?`（与全局合并）与 `destination?`（测试注入流）；redact 配置实际为 `[...REDACT_PATHS, ...redactPaths]`。
- `apps/worker/src/lib/dingtalk-bot.ts` 将 `MODULE_REDACT` 上移到 `createLogger` 之前并 **`redactPaths: [...MODULE_REDACT]` 真正传入**。
- 测试：`packages/shared/src/__tests__/logger.test.ts` 新增**真实序列化**用例 —— 用可捕获 Writable 流断言输出中 `password/token/webhookUrl/signSecret` 均为 `[REDACTED]` 且原始 secret 子串不出现。

**对抗性核验**：

1. 确认是 redact **配置**层生效（不是靠调用方手动 mask）—— 看 logger.test 的流断言，而非常量断言。
2. 确认 snake_case（DB 行形态 `webhook_url`）与 camelCase（JS 对象 `webhookUrl`）都在 paths 内。
3. 旁证：`dingtalk-bot.ts` 业务日志本就只打 `maskedUrl` —— redact 是纵深防御，覆盖 err 对象/未来调用方泄漏路径。

---

## #3 (Critical) — 覆盖率 metric_key 与 seed 不匹配，恒判 degraded

**原始 finding**：`briefing-gen.ts` 要 `cu_main_change_pct/lc_main_change_pct/usd_cny`；seed 实际是 `cu_change_pct/lc_change_pct/fx_usdcny`（`0009_commodity_seed.sql`）→ 正常数据也被判覆盖不足。

**修复**：

- `apps/worker/src/jobs/briefing-gen.ts:69` `KEY_METRIC_FIELDS` 改为 seed 真实键 `["cu_main_close","cu_change_pct","lc_main_close","lc_change_pct","fx_usdcny"]`，并 `export` 供测试锁定。
- 测试：`briefing-gen.test.ts` 新增 drift-guard —— 断言等于上述集合，且**不含**三个旧错误名。

**对抗性核验**：

1. 交叉比对 `0009_commodity_seed.sql`：`sources.config.metric_keys`（:38 `cu_change_pct` / :51 `lc_change_pct` / :77 `fx_usdcny`）与 `briefing_template_fields.source_metric`（:319/:330/:343）—— 确认这 5 个键确实是 adapter/seed 产出名。
2. 确认 `briefing-gen.ts:311` 覆盖率计算 `KEY_METRIC_FIELDS.filter(k => presentKeys.has(k))` 用的就是这个常量。

---

## #4 (Major) — 临时 Queue/FlowProducer/Redis 不关闭（连接泄漏）

> **复评轮次 2：已真正修复（e4a7b29）。** 轮次 1（ce313c2）的判断错误已纠正 —— 详见下方「错误根因」。

**原始 finding**：`fetch.ts` 每 job 建 Redis+FlowProducer 无 close；`fetch.ts` scheduling 建 fetch queue 无 close；`briefing-gen.ts` 重试循环建 Queue；`cluster.ts` 建 Redis —— 均无 finally close/quit。

**错误根因（Codex 复评指出，已核实）**：BullMQ 5.76 `redis-connection.js:362` 为 `if (!this.extraOptions.shared) { … await this._client.quit() }`。**传入一个已建好的 IORedis 实例会被标记 `shared`，`Queue.close()` 不会 quit 它。** 因此凡是「工厂默认建连」`createFetchQueue()` / `createBriefingPushQueue(createRedisConnection())` 之后只 `queue.close()` 的写法，连接仍泄漏。轮次 1 误以为 `Queue.close()` 会释放自建连接。

**修复（最终）—— 凡临时自建连接，显式保存句柄并 `quit()`**：

- `apps/worker/src/handlers/fetch.ts:20` — `sourceId===0`：`const conn = createRedisConnection(); const queue = createFetchQueue(conn); finally { await queue.close(); await conn.quit(); }`。
- `apps/worker/src/handlers/fetch.ts:88` — FlowProducer 块（轮次 1 已正确）：`flowProducer.close()` + `redis.quit()`。
- `apps/worker/src/jobs/briefing-gen.ts:435` — pushQueue：显式保存 `pushConn` 并 `finally { close(); pushConn.quit(); }`。
- `apps/worker/src/jobs/briefing-gen.ts:267` step 0（轮次 1 已正确）：保存 `ownPrecheckConn` 并 `quit()`。
- `apps/worker/src/handlers/cluster.ts:69`（轮次 1 已正确）：else 分支懒建 Redis + finally `quit()`。
- **测试断言 `quit()`**（Codex 要求）：`runner-announcements.test.ts` 新增 sourceId=0 调度路径用例，断言 `queue.close()` **与** `conn.quit()` 各一次；`briefing-gen.test.ts` Case 7 断言 `pushConn.quit()`。

**对抗性核验**：

1. 确认 fetch.ts:20 与 briefing-gen.ts:435 现在都 `conn.quit()`，不再依赖 `Queue.close()` 释放 shared 连接。
2. 确认对自建连接 `close()` 后 `quit()` 不会触发 "Connection is closed"（BullMQ 对 shared 连接 close 时本就不动它，quit 是首次关闭）。
3. 全 worker grep 复核：剩余 `createRedisConnection`/`new Queue` 仅 `bootstrap.ts:75/173/180` 属进程级长生命周期资源（worker shutdown runtime 统一关闭），非 per-job 泄漏。

---

## #5 (Major) — API 路由测试 mock 鉴权，无 401/403/越权覆盖

**原始 finding**：timeline/search/alerts/sources 测试 mock `getRequestUser` 默认 viewer，无 401、无 role matrix、无 includeBlocked 越权。

**关键事实**：真正的鉴权门是 `apps/web/middleware.ts`（401 无 token / 403 角色不足 / 页面重定向），路由 handler 大多不做路由级 401（alerts/sources 完全无路由级 auth）。原 `middleware.test.ts` 只测 header 克隆，**未测鉴权** —— 这才是真缺口。

**修复**：

- `apps/web/__tests__/middleware.test.ts` 新增真实鉴权用例（mock `getToken`，调用 middleware 断言响应码）：401 未登录 API / 页面重定向到 `/auth/login` / viewer→admin path 403 / viewer→editor(sources) path 403 / editor→admin path 403 / admin→admin 放行 / viewer→timeline 放行。
- `apps/web/app/api/search/__tests__/search-route.test.ts` 补 viewer 不能 includeBlocked / admin 能 includeBlocked（与 timeline 路由现有矩阵对齐）。

**对抗性核验**：

1. 确认 middleware 测试覆盖了 `isAdminPath`/`isEditorPath`/`isTimelineApi` 三类与对应 requiredRole（admin/editor/viewer）。
2. 评估是否仍有未覆盖的真实风险面（如 sources POST 的 editor 要求 —— 由 middleware `isEditorPath` 覆盖，已在 403 用例内）。判断该 finding 是否可降级（路由层本就委托 middleware）。

---

## #6 (Major) — loadScoringConfig 静默使用硬编码兜底

**原始 finding**：`context.ts` DB 缺行时静默用硬编码 weights/coef/thresholds，违反"配置必须存数据库"。

**修复**：

- `apps/worker/src/handlers/context.ts:48` 新增 `requireScoringConfig<T>()`：DB 有值用 DB；缺失时**生产环境（`NODE_ENV==='production'`）抛错 fail-fast**，dev/test 才用兜底并 `logger.warn`。
- 兜底常量集中到 `SCORING_CONFIG_DEV_FALLBACK`，4 个键（weights/t_coef/c_coef/thresholds）逐一经 `requireScoringConfig`。

**对抗性核验**：

1. 确认生产路径任一键缺失即抛错（不再静默），错误信息指向"运行 seed / admin 补全"。
2. 确认 dev/test 仍可无缝跑（兜底值与 seed 一致）。
3. 评估"仅 NODE_ENV 判定"是否足够（worker 无 isMockMode）；如需更严可加显式 mock flag —— 请给意见。

---

## #7 (Major) — 安全头不全（缺 HSTS / 非完整 CSP）

**原始 finding**：只有 X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy + 仅 frame-ancestors 的 CSP；缺 HSTS 与完整 CSP。

**修复**：

- `apps/web/next.config.js` 生产（`NODE_ENV==='production'`）追加 `Strict-Transport-Security: max-age=63072000; includeSubDomains` + 完整 CSP（`default-src/script-src/style-src/img-src/font-src/connect-src/frame-ancestors/base-uri/form-action/object-src`）。
- **dev 保留宽松 CSP**（仅 frame-ancestors），避免破坏 HMR websocket / react-refresh eval / e2e（dev server）。

**对抗性核验**：

1. 确认 CSP 含 `script-src 'unsafe-inline' 'unsafe-eval'`（Next 无 nonce 基建，去掉会白屏）—— 这是有意权衡，请确认可接受或建议引入 nonce。
2. 确认 HSTS 仅生产、仅 TLS 下有意义（内网 HTTP 下浏览器忽略，无害）；评估内网是否实际走 TLS。
3. `connect-src 'self'` 是否会挡住任何前端到第三方的直连（核对前端只打同源 API/SSE）。

---

## 复评结论请给

逐条 CONFIRMED-FIXED / NOT-FIXED / REGRESSED + 整体 APPROVED / REJECTED。
若全部 CONFIRMED-FIXED，则 Gate 2 关闭，可进入 `v1.0.0` tag 前的部署校验。
