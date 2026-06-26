# 情报系统测试反馈 — 修复计划（13 条）

来源：`情报系统测试.docx`。已对每条做代码级 scoping（file:line + 根因 + 范围）。

## 分级总表

| # | 反馈 | 类型 | 范围 | 关键定位 |
|---|------|------|------|----------|
| 1 | 仪表盘精选/信源健康度无法点击钻取 | 缺链接 | shallow | `admin/dashboard/page.tsx:41-47,247-294`；`/items/[id]` 路由已存在 |
| 8 | /items 列表页无筛选控件 | 前端遗漏 | shallow | `items/page.tsx:15-38`；后端早已支持 circle/tier/category 过滤，`FilterBar` 组件现成 |
| 9 | 信源列表加名称搜索 | 功能缺口 | shallow | `admin/sources/source-table.tsx`；行已全量 load，纯前端加 search state 即可 |
| 10 | 评分配置 D1~D5 加提示图标 | 缺文案 | shallow | `scoring-config-editor.tsx:6-12,126-158` |
| 11 | 时间线 T1/T2/T3 加 tooltip | 缺说明 | shallow | `timeline-card.tsx:49` 等；无 tier 释义常量 |
| 2 | 告警详情无"返回上一级" | 导航缺失 | medium | `items/[id]/page.tsx:59-72` 面包屑写死 `/`；`alerts/page.tsx:319` 链接不带来源 |
| 3 | 告警时间范围隐蔽 + 计数/列表对不上 | 部分 bug | medium | `alerts/page.tsx:67`("24H"死文本)；`alerts-query.ts:84`(list 不按时间) vs `:155`(count 当日) **口径不一致** |
| 7 | 简报"重新生成"按钮 | **真 bug** | medium | 按钮/API 已存在，但 `force` 未透传(`bootstrap.ts:231`)+ duplicate-check 短路(`briefing-gen.ts:248-262`)+ `onConflictDoNothing`(:484) → **no-op** |
| 6 | 日报全部"暂无日报"+无法手动添加 | bug+缺功能 | medium | `daily_reports` **空表**(daily-gen 未成功写库)；展示层 sections 键不匹配；无 `POST /api/daily` |
| 5 | 每日简报生成失败 | 环境/数据 | medium | docx 模板/MinIO/Kimi **确定性失败**；查 `commodity_briefings.gen_error` 定位 |
| 13 | 信源列表存在爬取失败 | 真实抓取失败 | 运维 | 原因已落库 `sources.last_error`；被自动停用(≥7次)的失败源不进"仅失败"筛选(展示盲点) |
| 12 | 无法新增用户 | **真 bug/缺失** | deep | `api/users/route.ts` 只有 GET 无 POST；`users-admin.tsx` 无新增入口；需 bcrypt(12)+鉴权+UI |
| 4 | 告警只能逐条忽略，需批量 | **真 bug/缺失** | deep | `alerts/page.tsx:325` 忽略按钮**无 onClick**；dismiss DB/API/UI 全缺 |

## 执行批次（建议顺序，每批一个 codex 实现 + Claude Code 评审闭环）

### 批次 1 — 快速 UI（5 条，shallow，零 DB，低风险）
#1 钻取入口（卡片包 Link / 卡片标题链 `/items/[id]`）；#8 /items 挂 `FilterBar` + 转发筛选参数（后端已支持）；#9 信源名称搜索（前端 search state）；#10 评分 D1~D5 加释义 tooltip（文案对齐 scoring.ts，注意 D2_chain 是代码计算非模型）；#11 T1/T2/T3 加 tier 释义常量 + `title` tooltip。

### 批次 2 — 导航 + 告警口径（2 条，medium）
#2 alerts"查看详情"带 `?from=alerts`，详情页据来源渲染"← 返回告警"（或 client 端 history.back 按钮）；#3 `alertQuerySchema` 加 `range`(24h/7d/all)，让 list 与 count **用同一时间窗**（修口径 bug）+ 页面加可见时间范围/level 控件。

### 批次 3 — 简报/日报（#7 真 bug + 代码硬化）
#7 `BriefingGenJob` 加 `force`，bootstrap 透传，`runBriefingGen` force 时跳过 duplicate-check + Step5 改 `onConflictDoUpdate(briefingDate)`；daily-gen 空输入短路（不空烧 Kimi）+ 失败可观测；日报展示 sections 键与 LLM 产出对齐（前端只渲染 5 段或 prompt 补 hero/stat）；可选 `POST /api/daily`(admin) 手动 upsert。
> **#5/#6 的生产故障根因需服务器侧排查**（见下"运维诊断"），代码侧只能做硬化与可观测，无法在本地判定"为什么 prod 失败"。

### 批次 4 — 深度功能（2 条 deep，各自独立闭环）
#12 新增用户：`createUserSchema` + `POST /api/users`（bcrypt work_factor=12、admin 鉴权、写 auditLogs、不拉手机号）+ `users-admin.tsx` 新增表单。
#4 批量忽略：migration 加 `item_analysis.alert_dismissed_at` + `POST /api/alerts/dismiss`(itemIds[]) + alerts 列表改 client component 加 checkbox/批量操作条 + `baseAlertConditions` 加 `isNull(alertDismissedAt)`。

## 运维诊断（#5/#6/#13，需在服务器执行，与代码并行）
- 日报是否真空表：`SELECT date FROM daily_reports ORDER BY date DESC LIMIT 5;`
- 简报失败原因：`SELECT briefing_date, gen_status, gen_error FROM commodity_briefings ORDER BY briefing_date DESC LIMIT 5;` → 看是 `TEMPLATE_READ_FAILED`/`TEMPLATE_LINT_*`/`MINIO_UPLOAD_FAILED`/Kimi 错误中哪个。
- 失败信源：`SELECT name, fetcher_type, fail_count, last_error, last_error_at FROM sources WHERE last_error IS NOT NULL ORDER BY last_error_at DESC;`
- Kimi 连通性（worker 容器内）：确认 `KIMI_API_KEY`/`KIMI_BASE_URL` 可达；docx 模板 `/app/design/templates/briefing.docx` 是否存在；MinIO bucket `fe-radar-briefings` 是否创建。

## 不变量（执行器遵守）
apps/web 与 apps/worker 不互 import；core 不依赖 db；迁移幂等新增编号；bcrypt(12)/JWT httpOnly/不拉手机号；commit `[T-FB-XX] 动词+范围`；TS 严格无未使用变量+禁 as any；**验收必跑 build/tsc，不只 vitest+lint**（上次踩坑）。
