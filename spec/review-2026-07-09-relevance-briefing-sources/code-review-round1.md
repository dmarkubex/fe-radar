# 代码评审记录 — Round 1（2026-07-09，Grok 实现）

评审对象：T-REV-01/02/03/04 的实现（`git diff`，未 commit）
评审者：codex（VERDICT: REQUEST_CHANGES）、antigravity（VERDICT: REQUEST_CHANGES）
两份评审完全收敛，无相互矛盾，发现完全一致（含主会话预先标注的疑似问题 A/B 均被双评审确认成立）。

## 结论：REQUEST_CHANGES（2 MAJOR + 2 MEDIUM，需修复后二次评审）

### MAJOR-1（T-REV-02）LLM prompt 组装未用上新算出的涨跌幅，数据割裂

- `packages/llm/src/briefing.ts:147-150` `buildBriefingInput` 仍读 `q.changePct`（`commodity_quotes.change_pct` 列，`quotes-fetch.ts` 恒写 null），而不是去找同批 quotes 里 `metricKey==='cu_change_pct'` 那一行的 `.value`（T-REV-02 写入的正是这个）。
- 后果：喂给 Kimi 的 prompt 里 `cu_main_close` 那行仍显示"涨跌幅 —"，新增的 `cu_change_pct` 又被当成一个独立、语义割裂的"行情项"列出（`cu_change_pct: 0.0067（涨跌幅 —）`），LLM 拿不到正确信息还会被无意义的行干扰。
- 修复方向：在组装 prompt 前把 `cu_change_pct`/`lc_change_pct` 的独立行合并回对应的 close 行（作为其 `changePct` 属性），从 `quotes` 数组里剔除这两个 derived 行本身，避免它们又被当成正常行情项打印一遍。

### MAJOR-2（T-REV-02）docx 渲染无百分比格式化，显示原始小数

- `packages/core/src/briefing.ts:mapTemplateFields` 与 `apps/worker/src/lib/briefing-render.ts` 都只是把 `quote.value` 原样透传，没有 `*100`/`%` 格式化。
- 后果：`computePctChange` 存的是小数（如 `0.0067`），docx 里"沪铜涨跌幅"字段会显示成 `0.0067` 而不是 `0.67%`。此前这两个字段从未被真实数据填充过（一直是 fallback `"—"`），所以这个格式化缺口从未暴露。
- 修复方向：二选一 —— ① 在 `quotes-fetch.ts` 写入 derived 行时就存放大 100 倍并格式化好的值；② 在 `mapTemplateFields`（或渲染层）里对 `*_change_pct` 后缀的 placeholder 做统一的百分比格式化。两位评审都倾向后者（渲染层集中格式化，不污染 `commodity_quotes` 原始数值语义），落地时请二次确认。

### MEDIUM-1（T-REV-02）前值回看窗口 7 天，跨不过长假

- `PREV_CLOSE_LOOKBACK_DAYS=7`，国庆/春节等带调休长假可达 8-9 天全无交易，长假后第一个交易日会查不到前值，算不出涨跌幅（不算错，只是又缺一次）。
- `findPreviousCloseValue` 用 `observed_at < sample.observedAt`（原始 timestamp 比较）而非"排除今天日历日"的边界，理论上如果同一天有多次写入（目前 cron 每个工作日仅 15:30 跑一次，暂不会触发，但逻辑本身不健壮）。
- 修复方向：窗口放宽到 15 天以上；比较边界改为 Asia/Shanghai 日历日的"严格早于当日 00:00"，而不是原始 observedAt timestamp。

### MEDIUM-2（T-REV-04）别名消歧测试是形式覆盖，未真正验证排序

- `ner.test.ts` 里 "alias disambiguation" 测试的 DB mock 直接返回"已排好序的单行结果"（`[{id:1,circle:'C1',weight:0.8}]`），mock 本身不做任何排序，等于绕过了对 `orderBy(CIRCLE_RANK_SQL, desc(weight))` 真实生效与否的验证。
- 修复方向：mock 改为返回未排序的多行（如先给一条 C2 高 weight 再给一条 C1 低 weight），验证选中的仍是 C1 那条；或者直接断言生成的 SQL/orderBy 调用参数符合预期。

## 已核实通过，无需改动

- T-REV-01（runbook）：禁用机制描述准确（`fail_count>=7`，非天数），闭环完整。
- T-REV-03（PBOC）：核实记录合理，"不启用"决策符合 spec 防御性约定，未留死迁移。
- T-REV-04 SQL 本身：`arrayContains` 走 GIN 索引原生查询，`CIRCLE_RANK_SQL` 固定模板无注入面；精确别名匹配未引入模糊误报，未触碰 `computeD2Chain`/`computeAlert`/`item_entities` schema。
- Diff 范围：未触碰 SHFE/GFEX/SMM adapter 内部逻辑，符合 spec "不改 adapter" 的约束。
- `pnpm -r typecheck` / `pnpm -r test`（754 tests）均通过（codex 已验证）。

## 下一步

交回 Grok/Cursor 按上述 4 点修复（MAJOR 优先），修复后重新提交本管线做 Round 2 评审，直到 codex + antigravity 双 APPROVE。

原始评审全文：

- codex: `/private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/codex-code-report.md`
- antigravity: `/private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/agy-code-report.md`
