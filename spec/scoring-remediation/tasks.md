# 评分链修复与历史重算任务

状态：Execute

日期：2026-08-04
依据：`spec/requirements.md` §5、§7、NFR-01；`spec/design.md` §5、§6

## T-SR-01 实体字典与污染清理

- goal: 补齐当前已启用竞品/下游公司的 C2 实体，并移除生产测试实体造成的历史误关联。
- constraints: 配置仍存 DB；复用 0045 的条件 upsert，只补空 circle、追加缺失 alias、绝不覆盖非空 admin 值；删除只按已核实的测试实体完整指纹执行，且测试实体存在 `entity_financials` 时必须保留，避免未纳入快照的级联删除。新增 C2 为：东方电缆[`宁波东方电缆`]、Nexans[`Nexans Group`]、中国电建[`中国电力建设集团`,`POWERCHINA`]、中国能建[`中国能源建设集团`,`CEEC`]、明阳智能[`明阳智慧能源`,`MingYang`]、万科[`万科企业`,`万科集团`]、保利[`保利发展`,`保利地产`]、华润置地[`华润置地有限公司`]、龙湖[`龙湖集团`]、绿地[`绿地控股`,`绿地集团`]、阳光电源[`Sungrow`]、华为数字能源[`Huawei Digital Power`,`Huawei`]、科华数能[`科华数据`,`Kehua Tech`]、海博思创[`HyperStrong`]。
- ask_agent_first: `scoring_entity_plan` 已完成生产只读核查；实施前复核 migration 编号、FK 顺序和生产影响数。
- owner: agent-db
- scope: `packages/db/migrations/0052_entity_dictionary_repair.sql` 及其最小迁移契约测试。
- rollback: 部署 migration 前把两个测试实体原行及其关联导出到外部备份，并把固定 target item 集合的 `item_analysis`/`item_entities` 写入运维快照；新增实体仅在无引用时删除，历史数据仅按 run_id 固定集合恢复。
- acceptance: 14 个新增公司均为 C2 且逐行 alias 正确；测试实体及其关联归零；迁移幂等且不覆盖非空 admin 值。

## T-SR-02 D2 规则对齐

- goal: 让 D2 完全符合设计：C1=95、至少两个 C2=80、一个 C2=70、C3=50、无命中=20。
- constraints: D2 只由代码计算；不得引入 LLM；不改变权重、T/C 系数或其他原子分。
- ask_agent_first: `scoring_core_plan` 已完成调用链和测试边界核查。
- owner: agent-core
- scope: `packages/core/src/scoring.ts` 与对应单元测试。
- rollback: 回退函数与测试；历史结果按重算前固定 item 集合快照恢复。
- acceptance: 五个规则分支精确通过；多实体顺序不影响结果；全量 core 测试通过。

## T-SR-03 预筛硬闸门与评分标尺

- goal: `is_industry_related` 非 true 时下游 handler 只 dequeue/no-op，不能入精选或告警；为 D1/D3/D4/D5 建立一致的 0–100 证据标尺。
- constraints: false/unknown 均 fail-closed；不得恢复 `<=10 ×10`；D2、tier、circle 不得重复抬高四个 LLM 原子分；数值仍由 schema clamp 到 0–100。
- ask_agent_first: `scoring_core_plan` 与 `scoring_llm_plan` 已完成只读核查；独立计划评审已确认静态 BullMQ flow 会继续唤醒父任务，因此不能把 prefilter 的 return 当作取消机制。
- owner: agent-worker + agent-llm
- scope: NER/scorer/embedder/cluster/curator 五个 handler 复用同一个 `isIndustryRelated === true` 防线；prefilter 在非 true 时同步清 `is_curated/alert_*` 并把 false 标为 `dropped_filter`；scoring/prefilter prompt 与最小契约测试。
- rollback: 回退 worker/LLM 镜像；已清理历史字段按固定 item 集合快照恢复。
- acceptance: false/unknown 虽会被静态 Flow dequeue，但五个业务函数及其外部副作用均不执行；相关项正常通过；`is_industry_related IS NOT TRUE` 的精选与告警为 0；评分请求 temperature=0；8/5.5 等低分保持原值。评分 rubric 固定使用 0/20/40/60/80/100 六档，并分别约束 D1 政策约束力、D3 量化市场信号、D4 技术突破、D5 可行动商业影响；生产样本覆盖政策/价格/技术/招标/公司五类及高低分对照。

## T-SR-04 近 7–90 天分阶段重算

- goal: 固定目标 item 集合，先重算 0–7 天并验收，再扩到 7–90 天；只重跑必要阶段且可恢复、可续跑。
- constraints: 默认 dry-run，写入必须 `--apply`；不重跑 embedder/cluster；历史 false 确定性清 `is_curated=false, alert_type=NULL, alert_level=NULL` 且零 LLM；unknown 仅重跑 prefilter，转 true 后才进入 scorer/curator；实体补链由限定窗口的字典回填完成，不触发 NER/websearch 副作用；normal 评分逐条经过现有 NFR-01 配额且固定 `isPriority=false`。一旦 admission 后进入 scorer，无论 scorer/curator 成败都不得 rollback 配额，避免重试使实际 LLM 调用突破 1300。
- ask_agent_first: `scoring_entity_plan` 与 `scoring_llm_plan` 已给出窗口、队列和配额风险；发布前再次核对生产计数器与队列水位。
- owner: agent-worker + Codex
- scope: 新增 migration/schema：`scoring_reprocess_runs(run_id,from_at,until_at,status,created_at,completed_at)` 与 `scoring_reprocess_targets(run_id,item_id,status,attempts,last_error,updated_at)`，只持久化固定目标和 checkpoint，不复制正文；`backfill-circles.ts` 要求 `--run-id`、只 JOIN `scoring_reprocess_targets` 固定集合、默认 dry-run并把集合内无实体 item 纳入 D2 重算；`reprocess-scoring.ts` 直接复用 prefilter/scorer/curator handler，不创建全链 Flow。重算使用全局 Redis 锁，领取 target 必须状态 CAS，普通续跑不领取 `running`；仅在人工确认旧进程已停止后允许显式 `--recover-running --apply`。生产操作先在仓库外保存 analysis/entity 快照及校验和，再由 `--prepare --apply` 固定 target IDs，之后才允许 backfill/reprocess。
- rollback: 停止重算脚本进程；仅对该 run_id 固定目标集合删除并恢复仓库外 analysis/entity 快照；不使用动态 `now()-90 days` 回滚。验收完成后显式清理该 run 的 checkpoint 行。
- acceptance: 0–7 天通过后才执行 7–90 天；false scorer 调用为 0；记录 normal counter 前后值、reprocess admission/额度不足数且 normal≤1300；失败的已 admission 项也占用一次额度；重算不产生 embedder/cluster job；D2 与设计逐条一致；中断后按 checkpoint 续跑，第二次 dry-run 待处理数为 0。

## T-SR-05 构建、部署与生产验收

- goal: 先固定 target IDs 并保存运维快照，只构建/部署受影响的 worker/migrate 镜像，再执行 0–7 天 canary、7–90 天扩展和生产验证。
- constraints: 保留工作区既有未提交改动，不纳入提交/构建；Portainer stack 89、endpoint 3；迁移先于 worker；不打印 secret/env 值。
- ask_agent_first: 独立代码评审通过后再发布。
- owner: Codex
- scope: 部署前固定 target IDs、保存 `item_analysis`/`item_entities`/测试实体快照及校验和；精确提交、Harbor 推送、Portainer 更新；部署后先 0–7 天、验收通过后 7–90 天；最后做 SQL/日志/配额/样本验收。
- rollback: 恢复 stack 到部署前镜像 digest；按 T-SR-04 固定目标快照恢复数据。
- acceptance: migrate exit 0 且登记 0052/0053；worker image id 与 Harbor digest 一致；容器健康；近 90 天 false/unknown 精选告警归零；抽样确认新实体、D2 和评分标尺生效。
