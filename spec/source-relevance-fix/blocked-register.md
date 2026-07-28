# source-relevance-fix 阻塞登记（needs_human_review）

> 对应 `.ai/reviews/2026-07-27-source-relevance-fix-impl-adversarial-review.md` 合并修正清单第 6 条：
> 「若 human 前置仍未就绪，须显式登记 blocked + `needs_human_review`，**不得静默跳过**」。
>
> 本文件的作用是把"没做"从"疏漏"变成"有据可查的挂起"。**下列任一项在解除阻塞前，本批次都不构成 tasks.md 全局完成判据的达成。**

- 建立日期：2026-07-28
- 本轮实现器：主会话（Claude Code）
- 环境实测证据见 `baseline.md` §为什么还没有数据

## 环境阻塞事实（一次实测，多卡共用）

| 事实                    | 证据                                                                                                                                            | 影响卡                        |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 无生产 DB 连接          | `docker ps` → daemon 未运行；无 `DATABASE_URL`                                                                                                  | T-REL-00 / 02 / 03 / 07③ / 08 |
| 本机网络失真（fake-ip） | `dig www.nea.gov.cn` → `198.18.0.164`、`www.ndrc.gov.cn` → `198.18.0.165`；nea/ndrc/miit/cec 四站 curl 均 `HTTP:000`；对照 cnesa.org `HTTP:200` | T-REL-02 / 03 / 07③           |
| 代理池 P0 未落地        | `docker secret create proxy_list` + `PROXY_POOL_ENABLED=true` 未执行（见 handoff.md Human Action Required）                                     | T-REL-02                      |

**关键纪律**：本机失真网络正是根因 R1 —— `0014` 当初就是在这种网络下把政府源误判为"不可达"并批量禁用。因此本轮**刻意不产出 `0038` 迁移**，避免用同一口失真的井水再打一次水。

## 逐卡状态

### T-REL-00 现状盘点 — BLOCKED（运维）

- 阻塞点：需在部署环境（或只读副本）执行 5 组 SQL。
- 已交付：`baseline.md` 待填模板，SQL 可直接复制执行，含第 4 组的判读规则。
- 解除条件：运维执行并回填 → 本批次才具备量化验收锚点。

### T-REL-02 T1 政府/协会源批量重激活 — BLOCKED（运维 → 实现器）

- 阻塞点：① 代理池 P0 未落地；② 部署网络复测未执行。
- **本轮刻意未做**：未写 `0038` 迁移。卡片 constraints 明写「必须先测后改……禁止凭本文档的本机实测结果直接启用」，本机 `HTTP:000` 既不能证明源站死、也不能证明活。
- 解除条件（按序）：代理池通电 → 走生产 fetcher 复检（代理池 / 真实 UA / robots / 解析器）并将报告落盘 `verify-report.md` → 仅对 smoke ≥3 条的源写 `0038`（带 `admin_touched_at IS NULL` + `admin_snapshot ? 'enabled'` 守卫，且重激活必须同时 `fail_count=0, last_error=NULL`）。复检只读，不自动改 `enabled`。
  - **生产 worker 容器**（镜像内无 tsx、无 TS 源码，只含 `dist/`）：
    ```
    cd /app/apps/worker && node --import ./register-aliases.mjs dist/apps/worker/src/scripts/verify-sources.js --include-disabled
    ```
  - **开发机**（有 monorepo + tsx）：
    ```
    pnpm --filter @fe-radar/worker verify:sources -- --include-disabled
    ```
- 未达标源保持 disabled，`last_error` 必须写本次复测的真实原因，不得留两个月前的旧记录。

### T-REL-03 国家能源局适配 — 代码就绪 / 启用 BLOCKED

- 已完成：`nea-news.ts` JSON adapter + `0039` 迁移；本轮追加 endpoint 由写死 hash 放宽为 `/^\/xwzx\/ds_[0-9a-f]{32}\.json$/` 模式匹配（上游 republish 换 hash 不再失效），并补 `FETCH_PARSE` / `FETCH_JSON_EMPTY` 错误链路测试。
- 仍 `enabled=false`：属"适配准备完成"，**不等于信源已救回**。
- 解除条件：部署网络 smoke ≥3 条真实新闻标题 → 启用 → items 抽查证据落盘。

### T-REL-04 CNESA — 阻断 bug 已修 / 重新启用 BLOCKED

- 上轮阻断项已闭合：`0040` 原配置 `.post-date` + `enabled=true` 会给历史条目打假"今天"时间戳。
- 本轮实测复核（2026-07-28，生产页 `HTTP:200`，12 条 `article.et-item`）：**列表页内不存在任何日期节点**——无 `.post-date`、无 `<time>`、无任何含 date 的 class。真实发布时间仅存在于详情页（`<div class="union-time">在 2026-07-20 发布</div>`）。故这不是"选错 class 名"，而是现有 `fetchHtml`（单列表页抓取）结构性取不到。
- 处置：`0040` 改为 `enabled=false`，保留已验证可用的 title/link/content selector，date selector 记为真实类名 `.union-time` 供后续使用，`last_error` 写明原因。
- 解除条件：fetcher 支持「按 item 二次抓详情页取日期」后重新评估。该能力涉及每条目额外网络请求与 robots/频率合规，**超出 T-REL-04 卡 scope（仅迁移文件）**，需另开任务卡。

### T-REL-05 死源替换 — 部分完成 / 替代源 BLOCKED（human）

- 已完成：`0041` 固化 CWEA 软禁状态（`news_lastest.js` 动态注入不可解析），CPIA / escn 保留 `0023` 首页修复未回退。
- BLOCKED：新增替代垂直源需 human 拍板（属"信源精选"产品决策），且每源须逐个满足 robots 放行 + 部署网络 smoke ≥3 条 + 分级理由，三条缺一不可。

### T-REL-07 光纤覆盖 — ①② 完成 / ③ BLOCKED（human）

- 已完成 ①：`prefilter.ts` prompt 判定范围补「光纤、光缆、光通信」并收窄泛科技边界。
- 已完成 ②：`0042` keywordFilter 词表追加「光纤/光缆/光通信/光模块/OPGW/ADSS」。
- **BLOCKED ③**：光纤垂直信源 seed（预分配号 `0043`）未产出。卡片自身写明「三处同步补齐，缺一处即无效」——因此**光纤主业在信源层面仍是零覆盖**，①② 只能提升既有源里光纤内容的召回，不能凭空产生光纤信源。
- 解除条件：human 拍板候选清单（方向：C114 通信网 / 光纤在线 / 讯石光通讯网）→ 逐源 robots + 部署网络 smoke ≥3 条 → 写 `0043`。
- 另 BLOCKED：卡片 acceptance #2 要求「≥50 条历史真实条目 A/B，召回不低于旧 prompt、精确率提升，数字落盘」——需生产 DB 取历史条目，随 T-REL-00 一并解除。

### T-REL-08 收紧告警豁免 — 未启动（按卡片设计）

- 卡片前置写明「T-REL-00 第 4 项数据出来后再启动」。数据未出，**未启动属于遵守卡片设计，不是遗漏**。
- 解除条件：`baseline.md` 第 4 组数据回填后按判读规则决定优先级。

## 非阻断项延期登记

| 项                                                                 | 处置                 | 理由                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 评审项 7b：`verify-sources` 探测前加 robots 预检                   | **✅ 已闭合**        | 运维深度复检入口已移入 `apps/worker/src/scripts/verify-sources.ts` 并复用生产 fetcher 分发；所有 HTTP(S) 源在调用对应 fetcher 前统一执行 `assertRobotsAllowed`，HTML/RSS/NEA 等路径仍保留 `fetchTextWithPolicy` 自身的同网络路径复检。已知 `verificationBlocked=true` 源更早直接跳过。DB 脚本保留为 CI 轻量可达性比例门，不再作为重激活证据。 |
| F1：`apps/worker/src/fetchers/html.ts:42` 的 `new Date()` 回退加固 | **延期，另开 issue** | selector 静默落空时回退到抓取时刻（`dateText ? new Date(dateText) : new Date()`），会把历史条目打上假"今天"时间戳且 URL 去重无法自愈。CNESA 事故的共享根因：本批仅用单源 `enabled=false`（`0040`）规避，系统性行为债仍在——应在 selector 静默落空时记 warn 或标 `needs_review`，避免静默污染时间线。                                           |

## 本轮已闭合的评审项（供复审对照）

| 评审项                                      | 状态                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 CNESA 日期造假（阻断）                    | ✅ 已修，见上 T-REL-04                                                                                                       |
| 6 流程债：blocked 显式登记 + 证据落盘可跟踪 | ✅ 本文件 + `baseline.md`（`spec/source-relevance-fix/`）                                                                    |
| 7a `0044` 匹配键 name→url + 行数断言        | ✅ 已修（`DO $$` 断言，count ≠ 4 即 RAISE EXCEPTION）                                                                        |
| 7b `verify-sources` robots 预检             | ✅ 已闭合，见上表                                                                                                            |
| 8 NEA endpoint hash → 正则                  | ✅ 已修 + 测试                                                                                                               |
| 9 `0040`/`0041` 守卫语义                    | ✅ 已修：经评审的窄例外——安全禁用 UPDATE 不设 admin 守卫（同 `0039` 口径）；config 维度仍受 `admin_snapshot ? 'config'` 保护 |
| 10 `0041` 时间戳语义                        | ✅ 已修：不再写 `last_error_at = NULL`，保留真实失败时间戳；`0039`/`0040` 同步统一                                           |
| 11 NEA 错误链路测试                         | ✅ 已补 `FETCH_PARSE` / `FETCH_JSON_EMPTY`                                                                                   |
| 12 tasks.md T-REL-06 文字矛盾               | ✅ 已修（acceptance #3 三源→两源并说明另两源性质）                                                                           |
| 2/3/4/5 供给侧主体                          | ⏸ 环境阻塞，本文件逐卡登记                                                                                                   |
