# FE-Radar 项目整体评估报告

> **评估日期**：2026-06-01  
> **项目**：FE-Radar — 远东控股产业情报雷达  
> **评估范围**：前端页面、后台取数、定时任务、基础设施、测试覆盖、工程规范  
> **当前状态**：v1.0 已完成 milestone，release 准备阶段；v1.1 Commodity Briefing 已有完整规格

---

## 一、项目概览

| 维度 | 数值 |
|---|---|
| Monorepo 结构 | apps/web + apps/worker + 4 packages |
| 数据库表 | 16 张（v1.0：11 张核心 + 1 张 scoring_config；v1.1：4 张 commodity） |
| Migration | 16 个（0001–0016） |
| API 路由 | ~25 个 endpoint |
| 前端页面 | 17 个路由（10 个用户页 + 7 个管理页） |
| 组件数 | 21 个组件目录 |
| BullMQ 队列 | 7 个 pipeline 阶段 + 5 个定时任务 |
| Fetcher 类型 | gov-html / rss / playwright / announcements（SSE/SZSE/CNInfo） / quotes |
| 测试文件 | 78 个，约 8600 行测试代码 |
| 测试/代码比 | 0.87（整体） |

---

## 二、分项评估

### 2.1 前端页面 ⭐⭐⭐⭐ (4/5)

**优点**：

1. **路由规划合理**：用户页（时间线/告警/精选/日报/搜索/简报）和管理页（Dashboard/Worker/Scoring/Sources/Users/Backlog/Entities/Briefing Targets）职责清晰
2. **RSC + Client 混合架构**正确使用：页面级用 Server Component 做首屏数据获取，交互部分（FilterBar、TimelineList）用 `"use client"` 配合 TanStack Query 做无限滚动
3. **RBAC 体系完整**：middleware.ts 统一拦截，三级角色（viewer/editor/admin），路由级鉴权
4. **组件化程度好**：timeline 系列（6 个）、briefing 系列（5 个）模块内聚，shared 组件复用
5. **Tailwind + shadcn/ui 一致性**：设计系统统一（globals.css 定义 design tokens）
6. **Filter 交互设计优秀**：URL-driven filter pills，可分享/可回退的筛选状态

**不足**：

1. **缺少全局 Error Boundary**：没有发现 `error.tsx` 或 `global-error.tsx`，路由级错误会直接白屏
2. **缺少 Loading Skeleton**：除首屏 RSC 外，列表加载无 skeleton 占位，用户感知"空白闪烁"
3. **`next.config.js` 过于简单**（仅 194B），缺少图片优化域名配置、headers 安全头（CSP/X-Frame-Options）
4. **E2E 测试只有 2 个**（release-smoke + admin-sources），前端交互回归保障弱
5. **`lib/mock-mode.ts` + `mock-data.ts` 残留在生产代码**：虽然对开发有用，但应在 build 时排除
6. **部分页面缺少 SEO/元信息**：admin 页面无 metadata export，但考虑到是内网系统，影响有限
7. **无 SSR 流式渲染**：时间线首屏数据全部在服务端等齐后才返回，数据量大时 TTFB 会偏高

### 2.2 后台取数 / Pipeline ⭐⭐⭐⭐ (4/5)

**优点**：

1. **8 阶段 pipeline 设计成熟**：fetch → prefilter → NER → scorer → embedder → cluster → curator，每阶段独立队列，可独立扩缩容和重试
2. **BullMQ FlowProducer 串行保障**：child job 链式执行，上游失败自动终止下游
3. **去重策略完善**：URL 精确匹配 + sourceId+normalizedTitle+date 指纹双层去重
4. **Scrubber 安全中间件**：PII 脱敏（手机/身份证/邮箱/内网IP/MAC/项目编号）+ 审计日志 + 阻断阈值
5. **Scoring 纯函数实现**：`computeD2Chain()` 和 `computeQualityScore()` 在 `packages/core` 中实现，无外部依赖，可单测
6. **Playwright 池化**：BrowserContext 复用 + 定期 restart，避免内存泄漏
7. **限速器 Lua 原子化**：双独立计数器（normal ≤ 1300 + priority ≤ 200），防止超配额
8. **Redis 分布式锁**：cluster 创建带锁，防多 worker 并发建簇

**不足**：

1. **runner.ts 过于庞大**（677 行）：所有 job handler 都在一个文件中，维护和定位困难。应按 job 类型拆分
2. **核心 pipeline job 缺少测试**：
   - `jobs/cluster.ts` — 无测试
   - `jobs/embedder.ts` — 无测试
   - `jobs/scorer.ts` — 无测试
   - `jobs/ner.ts` — 仅有 11 行 schema 测试
   - `jobs/prefilter.ts` — 仅有 22 行 samples 测试
   - 这些是 pipeline 最核心的逻辑，缺测试是高风险点
3. **LLM 客户端封装较薄**：qwen.ts（645B）/ deepseek.ts（514B）/ kimi.ts（825B），错误重试、超时、fallback 策略需要更细致的配置
4. **`flows.ts` 无测试**：FlowProducer 的 job 链编排是整个 pipeline 的骨架，但零测试覆盖
5. **缺少 Pipeline 可观测性**：无端到端的 pipeline 追踪（correlation ID），单条 item 从 fetch 到 curator 的全链路状态不易追踪
6. **Playwright 池无内存监控**：虽然做了池化复用和 restart，但没有 Prometheus 指标暴露 Playwright 内存水位

### 2.3 定时任务 / 调度 ⭐⭐⭐⭐ (4/5)

**优点**：

1. **调度分离架构**：scheduler 独立容器（1 replica），worker 可水平扩展（3 replicas）
2. **完整的 cron 覆盖**：
   - 每日 03:00 cleanup
   - 每日 08:00 日报生成
   - 工作日 15:30 行情抓取 / 16:00 简报生成 / 16:05 简报推送
3. **节假日感知**：`isBusinessDay()` 统一判断，命中节假日零 DB 写入
4. **自动禁用故障信源**：7 次连续失败自动 disable，防止持续消耗资源
5. **指数退避重试**：200ms 基数，合理的重试策略
6. **Worker 心跳**：15s 间隔 + 60s TTL，支持多实例监控

**不足**：

1. **fetch cron 硬编码 6 小时**：CLAUDE.md 提到"每 6 小时抓取"，但 cron 表达式在代码中定义而非数据库配置，无法 admin 后台调整抓取频率
2. **无 DLQ（Dead Letter Queue）**：最终失败的 job 没有统一查看/重试入口，需 admin 手动查 BullMQ failed 队列
3. **briefing-gen 与 quotes-fetch 竞态处理虽有设计但未验证**：设计文档中有竞态防护逻辑（查队列积压→延迟→abort），但缺少集成测试验证
4. **scheduler 无高可用**：单 replica，如果 scheduler 容器挂掉，所有 cron 停止直到 Portainer 重启
5. **cleanup job 无验证机制**：90 天数据删除后无法验证删除是否正确（如 FK CASCADE 是否生效），缺少 post-cleanup 校验

### 2.4 数据库设计 ⭐⭐⭐⭐½ (4.5/5)

**优点**：

1. **Schema 设计规范**：16 张表，关系清晰，CHECK 约束完善（quota_state、role、alert_type 等枚举约束）
2. **pgvector + zhparser**：中文全文搜索 + 向量相似度双引擎
3. **Migration 版本管理**：16 个 migration，递增编号，命名清晰
4. **FK 级联策略正确**：`feedbacks.item_id ON DELETE CASCADE`、`clusters.lead_item_id ON DELETE SET NULL`
5. **软删除设计**：v1.1 `briefing_targets` 用 `disabled_at` + `enabled=false`
6. **Seed 幂等性**：`ON CONFLICT DO NOTHING`，重跑 migration 不覆盖 admin 配置
7. **Drizzle ORM 类型安全**：全量 schema TypeScript 化

**不足**：

1. **缺少索引文档**：虽然有 `0003_sources_idx.sql` 和 `0005_pgvector_index.sql`，但没有索引策略文档说明哪些查询走哪个索引
2. **无数据库级监控**：Grafana 已部署但缺少 PostgreSQL 指标面板（连接数、慢查询、表膨胀、死锁等）
3. **repos 层单薄**：只有 `repos/sources.ts`（3.8KB），其他表的查询分散在 API 路由和 worker 中，缺少统一的数据访问层
4. **无数据库备份自动验证**：手动触发备份，无 restore test 流程

### 2.5 工程规范 / CI/CD ⭐⭐⭐⭐ (4/5)

**优点**：

1. **CI 流水线完整**：lint → typecheck → test → build → madge（循环依赖检测），覆盖所有质量门
2. **Integration 流水线**：在 master push 时运行，额外加 Redis service
3. **Husky + lint-staged**：commit 级自动 lint + prettier
4. **ESLint + Prettier + TypeScript strict**：代码风格强制
5. **Monorepo 模块边界清晰**：web ↔ worker 不互相 import，core 不依赖 db
6. **spec 文档极其完善**：requirements v0.8 / design v0.7 / tasks v0.2，经过 6 轮 Antigravity 评审（DMA-6 到 DMA-24）

**不足**：

1. **无 Docker image 自动构建**：stack.yml 引用 `fe-radar/web:latest` 和 `fe-radar/worker:latest`，但没有 Dockerfile 或 CI step 来构建这些镜像（Dockerfile 未在 repo 中找到）
2. **无自动化部署流水线**：Portainer 手动操作，无 git tag → build → deploy 自动化
3. **Secret 管理原始**：Docker Swarm external secrets 手动 `printf | docker secret create`，无轮换自动化
4. **E2E CI 未完整接入**：`e2e.yml` 存在但需要完整环境（含 DB/Redis），可能未在 CI 中稳定运行
5. **缺少性能基准测试**：vector-benchmark.ts 存在但不在 CI 中，性能退化无门控

### 2.6 测试覆盖 ⭐⭐⭐½ (3.5/5)

**优点**：

1. **整体测试/代码比 0.87**，对于企业级项目属于良好水平
2. **packages/db 测试比 1.23**，schema + seed + migration 验证充分
3. **Worker 的 fetcher 层测试充分**：gov-html / announcements / quotes 各有详细 fixture
4. **packages/core 纯函数测试到位**：scoring / quota / cluster / scrubber / briefing 都有覆盖
5. **Playwright E2E**：admin-sources + release-smoke 两个关键流程有覆盖

**不足**：

1. **核心 pipeline job 测试严重不足**（详见 2.2）
2. **无 API 集成测试**：API 路由测试只靠 middleware.test.ts（1.6KB），缺少 endpoint 级集成测试
3. **无前端组件测试**：21 个组件目录无任何 `.test.tsx`，UI 回归靠手工
4. **缺少 shared test utilities**：每个测试文件自行 `vi.mock()`，无统一 mock 工厂
5. **无 test setup 文件**：没有 vitest.setup.ts 或全局 fixture
6. **coverage 仅配置了 v8 provider 但无 CI 阈值门控**：即使覆盖率下降也不会阻断合并

---

## 三、架构级风险评估

| # | 风险 | 严重度 | 现状 | 建议 |
|---|---|---|---|---|
| R1 | **核心 pipeline job 无测试** | 🔴 高 | cluster/embedder/scorer/ner/prefilter 的 job handler 零测试 | 每个核心 job 至少 3 个测试用例（正常路径、异常路径、边界值） |
| R2 | **runner.ts 677 行单文件** | 🟡 中 | 所有 job handler + 心跳 + 启动逻辑在一个文件 | 按功能拆分：`handlers/*.ts`、`heartbeat.ts`、`bootstrap.ts` |
| R3 | **无 Pipeline 可观测性** | 🟡 中 | 单条 item 全链路追踪缺失 | 引入 correlation ID，每个 job 写 trace span 到 Redis/PG |
| R4 | **Scheduler 单点故障** | 🟡 中 | 单 replica，无 HA | 考虑 Redis-based leader election 或 Kubernetes CronJob |
| R5 | **无 DLQ 统一处理** | 🟡 中 | 失败 job 需手动查 BullMQ | 添加 admin DLQ 查看页面 + 批量重试按钮 |
| R6 | **前端无 Error Boundary** | 🟡 中 | 路由错误直接白屏 | 添加 `error.tsx` 到每个路由目录 |
| R7 | **备份无自动验证** | 🟢 低 | 手动 pg_dump + MinIO | 添加 restore smoke test 到定期维护任务 |
| R8 | **Secret 无轮换** | 🟢 低 | Docker external secrets | 企业内网可接受，后续考虑 Vault |

---

## 四、亮点总结

1. **产品设计哲学成熟**："信源比信息重要" + "能用脚本就别用 Agent"是经过深思熟虑的架构决策，避免了对 LLM 的过度依赖
2. **Scoring 纯函数化**：`packages/core` 零外部依赖，所有评分逻辑可单测、可回测、可复现
3. **Scrubber 安全合规**：PII 脱敏 + 审计 + 阻断三重保护，企业级安全意识
4. **8 阶段 pipeline 架构**：每阶段独立队列，可独立扩缩、重试、监控，是正确的事件驱动设计
5. **RBAC + middleware 统一鉴权**：从路由级到 API 级全面覆盖
6. **Spec 文档质量极高**：经过 6 轮独立评审（DMA-6 至 DMA-24），在 AI 辅助开发中实属罕见
7. **关注圈 + 告警零漏报**：D2Chain 代码计算、priority 独立配额、alert_type 统一入口——核心业务逻辑的可靠性设计到位

---

## 五、改进建议优先级排序

### P0（阻塞发布 / 高风险）

1. **为核心 pipeline job 补充单元测试**：cluster/embedder/scorer/ner/prefilter 各至少 3 个测试
2. **添加 `error.tsx` 全局错误边界**：避免用户看到白屏

### P1（发布后第一迭代）

3. **拆分 runner.ts**：按 handler/heartbeat/bootstrap 分离，降低维护成本
4. **添加 Pipeline correlation ID**：从 fetch 到 curator 贯穿 trace ID
5. **补 API 集成测试**：至少覆盖 timeline/search/alerts/sources 4 个核心 endpoint
6. **添加 Dockerfile**：web 和 worker 的多阶段构建镜像
7. **DLQ admin 页面**：统一查看和重试失败 job

### P2（持续改进）

8. **数据库监控面板**：PostgreSQL 连接数/慢查询/表膨胀/锁等待
9. **前端 Loading Skeleton**：关键列表页添加骨架屏
10. **Test shared utilities**：统一 mock 工厂减少测试样板代码
11. **Coverage CI 门控**：设置最低覆盖率阈值
12. **CSP 安全头**：next.config.js 添加安全响应头

---

## 六、总体评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 产品设计 | ⭐⭐⭐⭐⭐ | 哲学清晰，功能完整，用户场景覆盖全面 |
| 架构设计 | ⭐⭐⭐⭐½ | 8 阶段 pipeline + 纯函数评分 + 模块边界清晰 |
| 前端实现 | ⭐⭐⭐⭐ | RSC 混合架构正确，RBAC 完善，缺 Error Boundary 和组件测试 |
| 后台 Pipeline | ⭐⭐⭐⭐ | 架构成熟，去重/限速/锁机制完备，核心 job 测试不足 |
| 定时任务 | ⭐⭐⭐⭐ | 覆盖全面，节假日感知，scheduler 单点是主要风险 |
| 数据库设计 | ⭐⭐⭐⭐½ | Schema 规范，FK 级联正确，pgvector + zhparser 选型合理 |
| 工程规范 | ⭐⭐⭐⭐ | CI 完整，lint/typecheck/build 全链路，缺自动部署 |
| 测试覆盖 | ⭐⭐⭐½ | DB/纯函数测试好，pipeline job/API/组件测试不足 |
| 安全合规 | ⭐⭐⭐⭐½ | Scrubber + RBAC + secrets + 审计日志，企业级水平 |
| 文档质量 | ⭐⭐⭐⭐⭐ | 6 轮独立评审的 spec，在 AI 辅助项目中极其罕见 |

**综合评分：⭐⭐⭐⭐ (4.1/5)**

> 这是一个设计质量远高于平均水准的项目。架构层面的成熟度（pipeline 分离、纯函数核心、安全中间件）体现了扎实的工程判断。主要短板集中在测试覆盖（特别是核心 pipeline job）和运维自动化（部署流水线、监控面板）上，这些都属于"做好就能从 4 分跳到 4.5 分"的可控改进项。
