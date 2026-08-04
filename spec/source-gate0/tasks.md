# 信源重建 Gate 0 — Tasks

## T-G0-01 — 生产证据基线

- **goal**：把 2026-08-04 生产路径复检和内容抽样落盘，作为 Gate 0 起点。
- **constraints**：只读；不得修改 sources；代理只用于 IP 路径，不绕 robots。
- **ask_agent_first**：无。
- **owner**：Codex。
- **scope**：`spec/source-gate0/evidence-2026-08-04.md`。
- **rollback**：删除本批新增证据文件。
- **acceptance**：62 行分类完整；通过候选、失败原因、合规跳过均可追溯。

## T-G0-02 — 逐源复检与 Gate CLI

- **goal**：消除单代理熔断污染，并提供机器可读、可失败退出的 Gate 0 报告。
- **constraints**：不自动改库；默认 CLI 行为兼容；无新依赖。
- **ask_agent_first**：无。
- **owner**：agent-infra / agent-worker。
- **scope**：`apps/worker/src/scripts/verify-sources.ts`、新 Gate evaluator、package scripts、最小测试。
- **rollback**：回退 CLI 文件和 package script；无数据回滚。
- **acceptance**：`--source-id` 只跑指定源；JSONL 稳定；7 日不足为 BLOCKED；阈值单测覆盖。

## T-G0-03 — 抓取运行历史

- **goal**：提供真实七日成功率分母/分子，不再用 `last_ok_at` 猜测稳定性。
- **constraints**：只存元数据；90 天清理；记录失败不阻断主抓取结果；migration 仅前向新增。
- **ask_agent_first**：无。
- **owner**：agent-db + agent-worker。
- **scope**：新 migration、DB schema/repo、fetch/quotes 装配、cleanup、测试。
- **rollback**：停止写入；前向 migration 保留表，必要时人工删除无业务依赖的运行元数据。
- **acceptance**：成功/失败各落 1 行；item_count 正确；异常不改变抓取判定；cleanup 删除 90 天外行。

## T-G0-04 — 关键源修复、招标源与覆盖配置

- **goal**：建立六域每域至少 2 个独立主办方的候选池，并让大型企业电线、电缆、储能公开招标成为独立可验收信号。
- **constraints**：只用官方/协会/交易所或明确授权源；新源默认 disabled；CNESA 缺真实发布时间前不得启用；Firecrawl 145 不启用。
- **ask_agent_first**：官方资料无法验证或 robots 结论不清的候选不落库。
- **owner**：agent-worker + agent-db。
- **scope**：官方 adapter/selector、招标关键词与公告类型解析、source config schema、前向 migration、fixture/smoke 测试。
- **rollback**：恢复旧 config；新增源软禁；不物理删历史行。
- **acceptance**：每个候选 ≥3 条且日期真实；抽样相关率 ≥80%；六域候选矩阵无空域；至少 2 个不同主办方的官方采购平台通过烟测并能区分招标/中标公告。

## T-G0-05 — 部署与七日 soak

- **goal**：在生产完成 Gate 0 七日稳定性验收。
- **constraints**：先过 migrate checksum；代理凭据不落仓库；Portainer 更新后核对镜像 digest、日志、队列和 DB。
- **ask_agent_first**：无；用户已批准执行 Gate 0。
- **owner**：Codex；七日未满时 Owner 保持 Codex，状态 BLOCKED_SOAK（不是完成）。
- **scope**：Harbor/Portainer、生产 DB、Gate 报告。
- **rollback**：关闭新源并恢复 stack 备份；代码镜像回退上一 digest。
- **acceptance**：requirements §4 全部 PASS，Gate CLI exit 0，报告落盘。
