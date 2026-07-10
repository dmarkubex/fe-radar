# 代码评审记录 — Round 2（2026-07-10，Grok 修复 Round 1 后再提交）

评审对象：Round 1 的 2 MAJOR + 2 MEDIUM 修复（`git diff`，未 commit）
评审者：codex（VERDICT: REQUEST_CHANGES）、antigravity（VERDICT: APPROVE）

## Round 1 四项发现 — 双评审一致确认：全部真实修复

- **MAJOR-1**（LLM prompt 数据割裂）：`mergeDerivedChangePctQuotes` 已在 `buildBriefingInput` 组装前正确合并 derived 行，剔除独立展示。✅ 双方一致确认修复。
- **MAJOR-2**（docx 无百分比格式化）：双方都专门核实了这不是"改错函数"的假修复——`apps/worker/src/jobs/briefing-gen.ts` 的 `buildTemplateFields → fmtMetric → formatMetricDisplay` 确实是 `renderBriefing` 实际调用的生产链路（而不是未被使用的 `packages/core` `mapTemplateFields`）。✅ 双方一致确认修复，且确认接入了真实渲染路径。
- **MEDIUM-1**（7 天窗口跨不过长假）：`PREV_CLOSE_LOOKBACK_DAYS=15` + Asia/Shanghai 日历日边界（`startOf('day')` + `lt`），双方一致确认足够覆盖国庆/春节等长假，时区处理无误。✅
- **MEDIUM-2**（别名消歧测试形式覆盖）：新增纯函数 `pickBestAliasHit`，测试改为传入乱序多行真实验证排序规则（C1>C2>C3>null，同 circle 按 weight 降序）。✅ 双方一致确认修复。

## 本轮分歧：codex 提出 2 个新 MEDIUM，antigravity 判定均为可接受的边界情况（非阻断）

**分歧点 1 — 同日多快照可能导致 change_pct 错配收盘价**

- codex：`mergeDerivedChangePctQuotes` 的 `derivedValues` Map 只按 `metricKey` 存值，若当天因重试/重新生成产生多条同 metricKey 快照（`commodity_quotes` 唯一约束是 `(metric_key, observed_at)`，同一天理论上可以有不同 `observed_at` 的多行），最后遍历到的哪一条会不确定地覆盖，可能把涨跌幅配对给错误的收盘价快照。
- antigravity：`queryTodayQuotes` 已经用 `DATE(observed_at)=today` 严格限定当天，不存在跨天覆盖；单日内多次写入时"最后一条覆盖"在当前架构下可接受。
- **主会话裁决**：两者都对，不矛盾——codex 说的是"理论上存在"，antigravity 说的是"当前架构下概率低、后果可控"。核实：`QUOTES_FETCH_SCHEDULE_CRON="0 30 15 * * 1-5"` 每个工作日仅跑一次；SHFE（`observedAt=candidateDate`，按交易日推导）与 smm-hq（`observedAt=parseShanghaiDate(renew_date, renew_time, now)`，仅在解析失败时才 fallback 到 `now()`）的 `observedAt` 在正常路径下都是确定性的，同日重跑通常会落在同一个 `observed_at`，经 `ON CONFLICT (metric_key, observed_at) DO UPDATE` 直接覆盖同一行，不会产生"多快照"。只有在 adapter 解析异常 fallback 到 `now()` 且当天被重跑（如 `force` 重新生成日报）时才会真正触发。**结论：真实但低概率的防御性缺口，不阻断本轮，要求在代码里补一条 `ponytail:` 风格的已知限制注释，留档待后续如遇到实际乱序现象再修**（不在本批次改动选取逻辑本身，避免过度设计）。

**分歧点 2 — 缺一条钉死"真实生产接线"的回归测试**

- codex：现有测试只验证了 `formatMetricDisplay`/`mergeDerivedChangePctQuotes` 这两个纯函数本身，以及未被生产使用的 `mapTemplateFields`；`briefing-gen.test.ts` 里没有一条测试断言 `buildTemplateFields` 真正吐出的 `fields.cu_change_pct === "0.67%"`。如果以后有人不小心把 `fmtMetric` 的调用改掉/删掉，765 个现有测试仍会全绿，不会报警——这正是本轮我们从"看起来修了"里揪出真实 bug（MAJOR-2 原始版本）的同一类风险。
- antigravity：未把这点列为阻断项。
- **主会话裁决**：采纳 codex 意见，**判定为本轮必须修复项**。理由：成本极低（加一条断言即可），价值直接对应本次评审踩过的坑（"改了一个同名但未被使用的函数"曾经真实发生过一次），值得留一个回归哨兵。

## 结论：CONDITIONAL PASS — 1 项必须补（低成本），1 项记录为已知限制（不阻断）

不要求发起完整 Round 3 双评审（改动范围小、无逻辑变更，性质是补测试哨兵），由主会话完成小改动后做一次读码复核即可提交。

**待办（Cursor/Grok 或主会话直接补，均可）**：

1. `apps/worker/src/jobs/__tests__/briefing-gen.test.ts` 补一条测试：注入 `commodity_quotes` 里 `cu_change_pct` 的 `value=0.0067`，断言最终传给 `renderBriefing` 的 `fields.cu_change_pct === "0.67%"`（钉死 `buildTemplateFields → fmtMetric → formatMetricDisplay` 的真实接线，防止未来被悄悄改掉/删掉）。
2. 在 `packages/core/src/briefing.ts` 的 `mergeDerivedChangePctQuotes` 函数上方补一条 `ponytail:` 风格注释，说明"同日多快照时按 Map 后写覆盖前写，当前单日单次 cron + adapter 确定性 observedAt 下不会触发；若未来出现 force 重跑导致同日多观测点，需要改成按 observedAt 配对 close/pct"。

原始评审全文：

- codex: `/private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/codex-code-round2.md`
- antigravity: `/private/tmp/claude-501/-Volumes-SD-AI-Timeline-web/7cab21eb-d9a7-4c6e-b3f6-266f5a1b55b4/scratchpad/reviews/agy-code-round2.md`
