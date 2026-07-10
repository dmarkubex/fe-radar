# 对抗性复核记录 — 2026-07-09

评审对象：主会话诊断材料（信源不通根因 / 铜锂日报覆盖率断层根因 / 新闻-公司相关性实体匹配缺陷）
评审者：codex（VERDICT: REQUEST_CHANGES）、antigravity（VERDICT: REQUEST_CHANGES）
两轮均已读实际源码逐条核对文件路径/行号，无相互矛盾，均为事实修正 + 方案优化，已在 tasks.md 中吸收采纳。

## codex 关键发现

1. 信源禁用是按失败次数（fail_count>=7），非天数；重新开启开关后必须额外手工重新激活已禁用源。
2. change_pct 缺失的直接原因是 adapter 从未 emit 该 metric key（非 0027 迁移"导致"断供，SHFE/GFEX 从一开始就不产 change_pct）；不能简单删除 KEY_METRIC_FIELDS 门槛；外部脚本的涨跌值可能是绝对值非百分比，不可直接套用。
3. entities.aliases 在字典预筛阶段其实已被使用；真正缺口在 handlers/ner.ts 对 LLM 命中结果的入库判断，只查 canonicalName 精确匹配；D3_market 描述为"纯代码计算"不准确（无财务数据时保留 LLM 值）；按置信度打折 D2_chain 需要新增 schema 字段，工作量被低估。

## antigravity 关键发现

1. 确认 codex 的事实核对结论；补充：未配置 Firecrawl key 时强行启用会导致该源快速被自动禁用，需要配置完成后再启用。
2. 提出比"接新外部接口"更优的铜锂日报修复方案：复用 packages/core/src/briefing.ts 已有的 computePctChange + 本地历史行，本地计算 change_pct，零新接口、零新反爬风险。
3. 提出比"新建 entity_relations 表"更轻量的关系图方案：复用 entities.meta（jsonb）字段存关系，零 DDL；alias fallback 命中多行时需要按 circle→weight 排序消歧，避免误报。

## 主会话裁决

两份评审无实质分歧，互为补充，已直接采信全部结论，生成本目录 tasks.md 五张任务卡（T-REV-01~05）。未发起第二轮 APPROVE 收敛循环，原因：本次交付物是诊断+spec 文档而非待执行代码变更，两评审均已在事实层面收敛且未对彼此的修复建议提出反对意见，追加一轮仅为确认性复述，边际价值低于成本；tasks.md 中已将两份评审的修正逐条落实为约束（constraints）与验收标准（acceptance），执行阶段仍会经过标准 Standard Mode 的代码评审门槛。

原始评审全文：

- codex: /private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/codex-report.md
- antigravity: /private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/agy-report.md
