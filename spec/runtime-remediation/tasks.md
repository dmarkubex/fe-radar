# FE-Radar 生产满足度修复批次

批准依据：用户于 2026-08-04 明确要求按既定优先级查明原因并修复。复用
`spec/requirements.md`、`spec/design.md` 与
`spec/source-relevance-fix/tasks.md` 已批准约束；本文件只收窄本次执行与验收边界。

## T-RR-01 — 信源供给恢复

- **goal**：对 enabled 零产出与 disabled 信源做真实抓取定性，恢复经 robots、内容相关性和稳定性验证的信源。
- **constraints**：不得启用索比、雪球、搜狗微信；Firecrawl-C1 在裸“远东”误配修复前保持禁用；代理不得绕 robots；不存原始 HTML。
- **ask_agent_first**：候选源涉及新增或替换时，先提交实抓证据与建议，不自行扩大信源清单。
- **owner**：Codex（脚本与运行态核验）；Human（新增信源最终选择）。
- **scope**：现有 `verify-sources`、信源配置与必要的最小 adapter 修复。
- **rollback**：变更前导出目标 `sources` 行；运行态变更按导出值恢复。
- **acceptance**：每个恢复源 smoke ≥3 条且内容相关；7 天产出不再由前三源占比 ≥90%；队列无持续失败积压。

## T-RR-02 — 告警证据链收紧

- **goal**：阻止无正文证据的事故/政策实体产生告警，并让存量非行业 safety/policy 噪音退出普通时间线与告警页。
- **constraints**：`computeAlert()` 仍是唯一告警触发入口；own/legal/risk 行为不变；本公司零漏报；core 不依赖 db。
- **ask_agent_first**：无；采用已批准的“事故 + 产业实体 + D5”护栏，并用生产误报分布验证。
- **owner**：Codex 实现；独立评审者复核。
- **scope**：NER 输出校验、`packages/core/src/alert.ts`、时间线/告警查询及对应测试。
- **rollback**：纯代码回退；无 schema 变更。
- **acceptance**：LLM 幻觉 span 不入库；真实产业事故仍告警；非行业 safety/policy 不再豁免；相关包测试与 typecheck 全绿。

## T-RR-03 — 聚类候选修复

- **goal**：消除固定前 100 个 cluster 候选导致的“一条新闻一个簇”。
- **constraints**：保留 Redis 创建锁；按 `spec/design.md` 使用 24h 内 pgvector 最近候选；不新增依赖。
- **ask_agent_first**：无。
- **owner**：Codex 实现；独立评审者复核。
- **scope**：`apps/worker/src/handlers/cluster.ts` 与最小回归测试。
- **rollback**：纯代码回退；不自动合并历史簇。
- **acceptance**：查询带 24h 窗口并按向量距离排序；相似条目进入同簇；并发创建锁不回退；worker 测试全绿。

## T-RR-04 — 产品与上下游实体覆盖

- **goal**：补齐远东产品、下游客户/EPC/储能集成商配置，并对存量数据安全回填。
- **constraints**：实体必须存 DB；seed `ON CONFLICT` 不覆盖 admin；D2_chain 继续由代码计算；先核实官方产品口径。
- **ask_agent_first**：官方资料无法确认的产品或企业不写入；候选清单先形成证据。
- **owner**：Codex（研究、迁移、回填）；Human（业务清单最终确认，如仍有歧义）。
- **scope**：新增前向 migration、现有 backfill 脚本与测试。
- **rollback**：迁移记录新增行标识；仅删除本迁移新增且未被 admin 修改的行；回填前记录受影响 item ids。
- **acceptance**：产品与下游不再为零；C1/C2/C3 语义符合 requirements；抽样回填准确；全量测试与真实 PG migration 验证通过。

## 全局完成判据

1. 主会话复核全部 diff 与测试，不采信执行器自述。
2. 独立代码评审无 Critical/Major。
3. `pnpm -r typecheck` 与 `pnpm -r test` 全绿。
4. 部署前验证 migrate 镜像内 checksum；部署后以 Portainer、日志、队列和生产 DB 行为为准。
5. 用户未跟踪的 Portainer 策略文件与脚本不纳入本批次。
