# 三议题修复 — 任务卡 (review-2026-07-09-relevance-briefing-sources)

> 来源：2026-07-09 对抗性复核（主会话诊断 + codex 独立评审 REQUEST_CHANGES + antigravity 独立评审 REQUEST_CHANGES，两轮均已就事实与方案收敛，无残留分歧）。评审原始记录见本目录 `review-notes.md`。
> 模式：Standard（跨 worker/db/core，单/多 agent 均可，中低风险；T-ENT-01 涉及评分/告警链路，风险中等，需要额外测试覆盖）。
> 评审门槛：typecheck + `pnpm -r test` 全绿；antigravity 或 mimo 代码评审 APPROVE；主会话复审通过。
> 本仓库交给 Cursor 实现时，Cursor 扮演「实现器」角色——**严格按每卡 scope 改动，不越界**；每卡改完先跑 acceptance 里列的验证命令，再提交下一卡。

## 范围总览

| 卡       | 主题                                       | 类型    | scope                                                                                                            | 风险 |
| -------- | ------------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| T-REV-01 | 信源重新激活 runbook 补丁                  | 仅文档  | `docs/runbook/deploy-portainer.md`、`handoff.md`                                                                 | 低   |
| T-REV-02 | 铜锂日报 change_pct 本地计算（不接新接口） | 代码    | `apps/worker/src/jobs/quotes-fetch.ts`                                                                           | 中   |
| T-REV-03 | PBOC `fx_usdcny` 源核实与启用              | 代码+DB | `packages/db/migrations/00XX_*.sql`（新迁移，不改 0009）                                                         | 中   |
| T-REV-04 | NER 别名 fallback + 消歧                   | 代码    | `apps/worker/src/handlers/ner.ts`                                                                                | 中高 |
| T-REV-05 | 实体关系图（meta jsonb 轻量方案，P2）      | 代码    | `packages/db/src/schema.ts`（无 DDL）、`apps/worker/src/lib/entities-dict.ts`、`apps/worker/src/handlers/ner.ts` | 中   |

T-REV-05 是新特性（评审建议的"轻量 wiki-link 效果"），与 T-REV-01~04（缺陷修复）性质不同，建议单独排期，不要求跟前四卡同批完成。

## 合规红线（全卡通用，违反 = 评审驳回）

- **D2_chain 必须代码计算**，不得引入 LLM 判定相关性（`packages/core/src/scoring.ts:computeD2Chain` 保持纯函数、输入仍为 `EntityHit[]`）。
- **90 天数据保留**（items/item_analysis/item_entities/cluster_items）不适用于 `commodity_quotes`——该表是 **365 天**保留（NFR-103，见 `packages/db/src/schema-commodity.ts:23`），T-REV-02 若涉及历史行查询需确认这一点，不要套用 90 天假设。
- **配置存 DB，不硬编码**；`entities`/`scoring_config` 等 seed 用 `ON CONFLICT DO NOTHING`；已上线的行为改动走**新迁移**，不改 0009/0027 等旧文件。
- **`computeAlert` 对任意 C1 命中都会触发 `own` 告警**（`packages/core/src/alert.ts:10-13`）——T-REV-04 的别名扩展如果引入误命中，会直接放大误告警，必须先做消歧再上线。
- 公网 LLM 调用前必经 `packages/core/scrubber.ts`（本批次不新增 LLM 调用）。
- TZ=Asia/Shanghai，时间一律 `dayjs().tz()`。
- commit message：`[T-REV-0X] 动词 + 范围`。

---

## T-REV-01 — 信源重新激活 runbook 补丁

- **goal**：把"代理池/Firecrawl 通电"补齐成完整闭环——评审发现原 runbook 只写了"开关+建 secret"，漏了"已被系统自动禁用的源需要手工重新激活"这一步，导致即使运维做完前两步，源依然拿不到数据。
- **constraints**：
  - 明确 `apps/worker/src/scheduler.ts` 的禁用机制：按 **失败次数**（`fail_count>=7`）禁用，不是天数（原文档/对话中的"7天"描述不准确，需改正）；`scheduler.ts:11` 与 `handlers/fetch.ts:36` 只处理 `enabled=true` 的源，禁用后不会自动恢复。
  - 新增步骤必须包含：① 确认 `PROXY_POOL_ENABLED=true` / `FIRECRAWL_API_KEY` secret 已生效；② 对受影响源执行 `UPDATE sources SET enabled=true, fail_count=0, last_error=NULL WHERE id IN (...)`（Admin 后台操作或 SQL，二选一写清楚）；③ 验证下一轮抓取后 `fail_count` 保持 0、`last_ok_at` 有更新。
  - 合规红线不变：代理仅绕 IP 封禁，不绕 robots.txt；雪球/搜狗微信/索比保持禁用。
- **ask_agent_first**：无（文档卡）。
- **scope**：`docs/runbook/deploy-portainer.md`（在已有 §7 信源抓取优化小节后追加"重新激活"子步骤）；`handoff.md` Human Action Required 补一行。
- **rollback**：删除新增文档小节，无运行时影响。
- **acceptance**：
  1. runbook 新增步骤覆盖"通电"→"重新激活"→"验证"完整链路，每步有可执行命令/SQL。
  2. 明确标注禁用机制是按失败次数不是天数。
  3. handoff.md 补一行待办，指向 runbook 新章节。

---

## T-REV-02 — 铜锂日报 change_pct 本地计算

- **goal**：让 `cu_change_pct` / `lc_change_pct` 两个 `KEY_METRIC_FIELDS` 有值，使 briefing 覆盖率脱离"永久 2/5"的死锁，且**不接入新的外部接口**（antigravity 复核建议：现有 `packages/core/src/briefing.ts:35` 的 `computePctChange(prev, curr)` + 本地 `commodity_quotes` 历史行即可闭环，比接 SMM `ajax/spot/history` 或长江有色网页解析成本低、不引入新反爬风险）。
- **constraints**：
  - **不修改** `smm-hq.ts` / `shfe.ts` / `gfex.ts` 等任何 fetcher/adapter 的外部请求逻辑（这几个源本来就不产 `change_pct`，改接口是过度设计，评审已否决）。
  - 改动点在 `apps/worker/src/jobs/quotes-fetch.ts` 的 `upsertQuoteSamples`（当前第 44-73 行硬编码 `change_pct=null`，`ON CONFLICT` 也把 `change_pct` 设为 `EXCLUDED.change_pct` 即恒为 null）：
    1. upsert 每条 `cu_main_close` / `lc_main_close` 新样本前，先查 `commodity_quotes` 里同 `metric_key` **上一个交易日**（`observed_at < 今日, ORDER BY observed_at DESC LIMIT 1`）的 `value`；
    2. 若查得到，调用 `computePctChange(prevValue, sample.value)` 算出百分比，写入一个**新的** `metric_key`（`cu_change_pct` / `lc_change_pct`，与 close 分开一行，不覆盖 close 行的 `change_pct` 列——因为 `KEY_METRIC_FIELDS` 是按 `metric_key` 而非按列取值，`briefing-gen.ts:337` 的 `quotesByKey` 是以 `metric_key` 为 key 的映射）；
    3. 若查不到前一日数据（首次抓取/数据缺口），跳过，不写该 metric_key（覆盖率自然反映真实缺数，不伪造）。
  - **必须复用** `packages/core` 导出的 `computePctChange`，不得重新实现涨跌幅公式（含 `ZERO_BASE_FALLBACK` 处理除零场景，见 `packages/core/src/__tests__/briefing.test.ts:23`）。
  - `commodity_quotes` 保留 365 天（非 90 天），历史行查询窗口不受 90 天保留策略影响，但仍要在查询里加合理的时间范围限制（如 `observed_at >= 今日-7天`）避免全表扫描。
  - 不改 `degradeFields` / `KEY_METRIC_FIELDS` 定义本身（`briefing-gen.ts:69-75`）——覆盖率门槛保持"5 个字段全非空"，靠补齐数据源头解决，不降低门槛（codex 复核明确反对直接删字段，那会把真实缺数伪装成成功）。
- **ask_agent_first**：`cu_change_pct`/`lc_change_pct` 这两个新 `metric_key` 是否需要在 `briefing_template_fields` 表里补充对应的 seed 行（供模板渲染字段查找用），需要先读 `packages/db/migrations/0009_commodity_seed.sql` 确认这两个 key 是否已经在 seed 里存在（若已存在则本卡无需动迁移；若不存在需要新迁移补充，仍然是新迁移不改 0009）。
- **scope**：`apps/worker/src/jobs/quotes-fetch.ts`（新增前一日查询 + change_pct 写入逻辑）。不改 `packages/core`、不改任何 adapter。
- **rollback**：还原 `quotes-fetch.ts`，回到硬编码 null 状态（無数据损失，`commodity_quotes` 是纯追加时序表）。
- **acceptance**：
  1. 单测覆盖：① 有前一日数据 → 正确算出 change_pct 并写入独立 metric_key 行；② 无前一日数据（首次/缺口）→ 不写该行，不报错；③ 前一日 value=0 → 走 `computePctChange` 的 `ZERO_BASE_FALLBACK` 分支。
  2. 集成验证：连续跑两天 `quotes-fetch` job（或 mock 两次不同日期），第二天 briefing-gen 的覆盖率检查里 `cu_change_pct`/`lc_change_pct` 不再永久缺失。
  3. typecheck 0 error；worker 包相关测试全绿。
  4. 不触碰 SHFE/GFEX/SMM 任何 fetcher 文件（diff 范围检查）。

---

## T-REV-03 — PBOC `fx_usdcny` 源核实与启用

- **goal**：核实 PBOC 源（`fx_usdcny` 唯一来源）当前是否可正常抓取，若可以则启用，补齐 `KEY_METRIC_FIELDS` 最后一个缺口。
- **constraints**：
  - **先核实再启用**：`0009_commodity_seed.sql` 里该源 seed 时就是 `enabled=false`，原因未记录在代码注释里，需要先手工/脚本试抓一次该源的实际 URL（对照 `apps/worker/src/fetchers/quotes/pboc.ts` 现有实现），确认无反爬/无权限问题、能正常解析出 `fx_usdcny` 数值，再决定启用。
  - 若核实发现该源确实有反爬或结构变化导致解析失败，本卡改为记录发现（更新 runbook 或本卡 acceptance 里的"未通过"结论），**不强行启用一个会持续报错的源**——那样只会把它推入 `fail_count>=7` 自动禁用的循环。
  - 启用走**新迁移**（如 `0028_enable_pboc_source.sql`），`UPDATE sources SET enabled=true, fail_count=0 WHERE ...`，不改 0009。
  - 与 T-REV-02 相同：不改 `KEY_METRIC_FIELDS` 定义本身。
- **ask_agent_first**：核实结果如果是"该源已失效/需要改造 fetcher 才能用"，先跟主会话确认是否要把这部分工作量并入本卡还是拆成新卡（因为如果需要重写 `pboc.ts` 的抓取逻辑，风险和工作量会从"低成本核实"变成"新 fetcher 开发"，需要重新评估）。
- **scope**：`packages/db/migrations/00XX_enable_pboc_source.sql`（新增）；若核实通过且无需改代码，仅此一个文件。
- **rollback**：新迁移的 down 是把该源重新 `enabled=false`。
- **acceptance**：
  1. 有一份核实记录（哪怕只是 commit message 或 PR 描述）：抓了一次该源，附实际返回数据/错误信息。
  2. 若核实通过：迁移落地后，下一轮 `quotes-fetch` 跑完，`commodity_quotes` 里出现 `fx_usdcny` 新记录，`fail_count` 保持 0。
  3. 若核实不通过：明确记录原因，不启用，不算本卡失败，是本卡的合法产出（诊断结论）。

---

## T-REV-04 — NER 别名 fallback + 消歧

- **goal**：修复 `apps/worker/src/handlers/ner.ts:34-40` 只按 `canonicalName` 精确匹配、不查 `aliases[]` 的缺口——这是当前"新闻与公司相关性弱"的最主要成因（LLM 抽取出别名/简称/子公司名时无法映射回 canonical 实体，直接判 0 命中）。
- **constraints**：
  - **必须先查 `canonicalName` 精确匹配（现有逻辑不变，保持向后兼容）；查不到时再 fallback 查 `aliases` 数组是否包含该抽取名**（用 `entities.aliases` 的 GIN 索引，`sql`\` ${entities.aliases} @> ARRAY[${entity.canonicalName}]\`\` 或等效的 drizzle 写法，具体看 packages/db 对 array 类型的现有查询模式，参考 `entities-dict.ts` 里字典预筛怎么读这个字段）。
  - **消歧规则（antigravity 复核明确要求，否则同一别名命中多个实体时会写入错误的 entityId）**：若 alias fallback 查询命中多行，按 `circle` 排序（C1 > C2 > C3 > null）取第一优先，同 circle 内按 `weight` 降序取第一条。若查询结果为 0 行，行为与现状一致（不写 `item_entities`）。
  - **不改** `computeD2Chain` / `EntityHit` 类型 / `item_entities` 表结构——评审已否决"按匹配来源打折 D2_chain"的提案（P1），因为 `item_entities` 目前无 confidence/match_type 字段，改动面过大，且 `computeAlert` 对任意 C1 命中都会触发告警，别名扩展必须先观察消歧后的实际效果再考虑是否要分级评分，本卡不做这一步。
  - 别名匹配命中时打一条结构化 info 日志（itemId + 抽取名 + fallback 命中的 entityId + circle），便于后续复核误报率。
- **ask_agent_first**：drizzle 对 `text[]` GIN 索引字段的"数组包含"查询语法，需要先确认项目里是否已有先例（搜 `packages/db` 里对 `aliases` 列的查询用法），避免绕过索引导致全表扫描。
- **scope**：`apps/worker/src/handlers/ner.ts`（仅 `handleNerJob` 内的实体入库循环，约第 34-40 行）。不改 `runNer`（`apps/worker/src/jobs/ner.ts`）、不改 `entities-dict.ts`、不改 `packages/core`。
- **rollback**：还原 `ner.ts`，回到纯 canonicalName 精确匹配。
- **acceptance**：
  1. 单测覆盖：① LLM 抽取名精确匹配 canonicalName（现状不变）；② 精确匹配失败但命中某实体的 alias（新增分支生效）；③ alias 命中多个实体，验证按 circle→weight 排序取到预期的第一条；④ 完全不命中（现状不变，不写入）。
  2. 抽样验证：找 3-5 篇历史上因为"提到远东控股某个别名/子公司名但 D2_chain=0"的真实 item（如果能从 DB 抽到），重跑 NER handler，确认现在能正确命中。
  3. `computeAlert`/`computeD2Chain` 相关测试保持全绿（没有被本卡改动影响的迹象）。
  4. typecheck 0 error；`pnpm -r test` 全绿。
  5. 日志里能看到 alias fallback 命中记录，便于上线后人工抽查误报率。

---

## T-REV-05 — 实体关系图（meta jsonb 轻量方案，P2，新特性，建议单独排期）

- **goal**：借鉴 wiki-link"实体关联"的思路，让子公司/供应商/竞品等**间接相关**的新闻也能获得合理的 D2_chain 加成，而不需要新建关系表（antigravity 复核方案：复用已有的 `entities.meta`（jsonb）字段存关系，零 DDL 成本）。
- **constraints**：
  - **数据结构**：在 `entities.meta` 里约定一个可选字段，如 `{"relations": [{"targetEntityId": 12, "type": "subsidiary", "weight": 0.5}]}`。**不新增迁移/不新增列**，只是约定 jsonb 内部结构（写入方式：Admin 后台维护或人工 SQL update，本卡不要求做 Admin UI）。
  - **NER/curator 阶段的一跳扩散**：命中某实体后，若该实体 `meta.relations` 非空，追加把关联实体也算作"间接命中"，但**权重必须打折**（不能让间接命中的分数等同于直接命中，否则会稀释 D2_chain 的准确性）——具体折扣系数、是否要连锁扩散（两跳）、如何避免关系环导致无限扩散，需要在实现前先跟主会话对齐设计细节，本卡的 acceptance 不预设具体数值，由实现前的 ask_agent_first 环节确定。
  - **不改** `entities` 表 schema（无新列）；**不改** `item_entities` 表结构；`computeD2Chain` 若要支持"直接/间接"区分，需要评估是否要给 `EntityHit` 增加一个可选字段（如 `viaRelation?: boolean`）——这是本卡范围内允许的最小 schema 级改动，但需要先过 antigravity/codex 二次评审确认不会误伤现有调用方。
  - 必须与 T-REV-04 的消歧规则协同：间接命中同样要走 circle/weight 排序防误报，且间接命中不应触发 `computeAlert` 的 "own" L1/L2 告警升级（一跳关联不等于本部委own risk，需要在 `computeAlert` 层面区分直接 vs 间接命中，避免告警噪声放大）。
  - 这是**新特性**，不是缺陷修复，工作量和风险都高于前四卡，建议单独走一次完整 Standard/Full Mode 流程（含 requirements/design 走查），本卡卡片仅作为该新特性的立项占位，不要直接在这里定最终方案细节。
- **ask_agent_first**：关系数据由谁维护（Admin UI vs 人工 SQL vs 半自动通过 LLM 离线批量生成候选、人工确认）？间接命中的权重折扣、扩散跳数上限、如何防止关系环？`computeAlert` 是否要新增"间接命中不算 own"的显式逻辑？这几项在动代码前必须先对齐，不能边写边猜。
- **scope**：待设计阶段确定，预估涉及 `packages/core/src/scoring.ts`、`packages/core/src/alert.ts`、`apps/worker/src/handlers/ner.ts`、`apps/worker/src/lib/entities-dict.ts`。
- **rollback**：设计阶段待定。
- **acceptance**：本卡当前状态为"待细化设计"，acceptance 标准将在设计对齐后补充；不建议 Cursor 直接按当前文字实现，先回主会话过一轮设计评审。

---

## 建议实施顺序

1. **T-REV-01**（纯文档，零风险，随时可做）
2. **T-REV-04**（收益最大：直接改善"新闻与公司相关性弱"的核心投诉，风险可控且有明确消歧规则）
3. **T-REV-02**（铜锂日报覆盖率断层，逻辑清晰，不接外部接口，风险中等）
4. **T-REV-03**（依赖 T-REV-02 之后再看整体覆盖率是否还差 `fx_usdcny`，且需要先核实源是否可用，可能产出"不启用"的合法结论）
5. **T-REV-05**（新特性，单独排期，不纳入本批次验收范围）
