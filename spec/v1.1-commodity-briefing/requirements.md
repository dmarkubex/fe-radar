# FE-Radar v1.1 — Commodity Briefing Requirements (v0.3 DRAFT)

> **模块代号**：`commodity-briefing`（铜锂大宗商品·每日行情简报）
> **状态**：DRAFT · v0.3（v0.2 待决 5 项 Q-11G/H/I/J/L 已 Human-decision 内化 · 2026-05-19）→ Antigravity Plan Review
> **最后更新**：2026-05-19
> **作者**：Claude Code（Plan Stage 产出）
> **v0.2 → v0.3 变更**：§11.1 增 5 条决策（Q-11G..L）· §11.2 清空 · 风险 R5 (16:00 夜盘) 决策对齐 · 后续动作清单更新
> **v0.1 → v0.2 修复点**：FR-105 推送方式（摘要+深链）/ 7 段 LLM 对齐 schema / support/resistance 代码计算 / FR-110 410 Gone 配齐 / 验收 12 项 / raw_text 边界澄清
> **基础依赖**：FE-Radar v1.0 已 GA（M0–M5 全部 Done · `spec/requirements.md` v0.8 / `spec/design.md` v0.8 / `spec/tasks.md` v0.3）
> **与 base spec 的关系**：本文档**只描述增量**；未声明的 FR/NFR/约束沿用 base spec。下文凡引用 base 章节用 `requirements §X` / `design §Y` / `tasks T-MX-YY` 格式。

---

## 0. 评审说明

按 AI Coding Kernel Full Mode 流程，本模块作为 v1.1 独立 feature 走完整 Plan Stage。
- 本文档约束 **WHAT**（要做什么），HOW 见 `design.md`，落地见 `tasks.md`
- v1.0 已上线意味着所有基础设施（抓取层 / pipeline / scrubber / 配额 / 关注圈 / 实体词典 / 钉钉 OAuth / Pino+Grafana / MinIO 备份 / 90 天 retention）已存在；本模块**只增不改**，禁止修改 v1.0 已交付字段与表
- 仅在以下三处对 v1.0 做新增 / 软扩展：
  - `entities` 表插入产品类词条（追加，不删改 v1.0 seed）
  - `sources` 表插入 RSSHub / 交易所 / 价格站源（追加，与 v1.0 seed 同表共存）
  - `apps/web` 顶部导航新增 "简报" 入口（增项不改 v1.0 现有路由）

---

## 1. 产品定位

**FE-Radar v1.1 · Commodity Briefing**：在 v1.0 产业情报雷达基础上，新增**原料价格视角**——每个工作日 16:00 自动生成"铜锂大宗商品·每日行情简报"（电解铜 CU + 电池级碳酸锂 LC），推送至指定钉钉工作群，辅助采购、成本预判、销售报价决策。

**一句话**：v1.0 是"看新闻"，v1.1 是"看价格"；两者共用 sources / pipeline / 关注圈 / LLM / 推送通道。

**与 v1.0 两条产品哲学的承接**：
1. **信源比信息重要** → v1.1 信源同样分级 T1（交易所官方接口 / 央行）/ T2（SMM / 生意社 / RSSHub 包装的资讯）/ T3（综合财经媒体快讯）
2. **能用脚本就别用 Agent** → **价格数值禁止 LLM 抽取**（数值精度敏感），数值来源必须是交易所接口或网页正则；LLM 只生成"行情逻辑总结""走势预判"段落

---

## 2. 用户与场景

**新增 2 类角色**（与 v1.0 §2 4 角色并存，权限模型不变）：

| 角色 | 重度功能 | 关心的信号 |
|---|---|---|
| 采购 / 供应链 | 简报推送、历史简报回看 | 当日铜锂主力 / 库存 / 加工费 / 进口量 |
| 销售（重大订单报价） | 简报推送、价格趋势判定 | 短期支撑 / 压力位、走势研判 |

**保留 v1.0 角色的新场景**：高层每日 16:00 在群里看到原料价格简报；采购协助决策"是否锁价"。

---

## 3. 功能需求 (FR)

### 3.1 v1.1 MVP 必须有

| FR | 功能 | 描述 |
|---|---|---|
| FR-101 | 每日简报自动生成 | 工作日 **16:00 Asia/Shanghai** 自动触发；周六日不生成；遇法定节假日跳过（节假日表手工维护） |
| FR-102 | 数值型 fetcher | 拉广期所 / 上期所 / LME / 央行 / 中国货币网 / RSSHub 包装的 SMM/生意社快讯，写入 `commodity_quotes` 时序表 |
| FR-103 | 简报内容生成 | 沿用 §7 模板字段；价格数值来自 `commodity_quotes`；"行情逻辑总结""走势预判"两段由 Kimi K2.6 生成 |
| FR-104 | 简报渲染 docx | 用 `design/templates/briefing.docx` 模板（占位符）+ docxtemplater 渲染；产物存 MinIO + 写 `commodity_briefings.docx_path` |
| FR-105 | 钉钉工作群推送 | 工作日 16:05 向指定群推送 **actionCard 消息卡片**（标题 + 当日核心摘要 + 站内深链 `/briefing/[id]`），用户点击跳详情页凭已登录态下载 docx；钉钉群机器人 webhook + 加签；失败重试 3 次，最终失败标 `push_status=failed` + admin Dashboard 红色告警。**v1.1 MVP 不发原生 docx 文件消息**（自定义机器人不支持，企业内部机器人 + 文件 API 推迟到 v1.2 评估） |
| FR-106 | 简报展示页 `/briefing` | 列出历史简报（倒序）+ 当日预览 + 重新生成按钮（editor+）+ 重新推送按钮（admin） |
| FR-107 | 推送目标管理 `/admin/briefing/targets` | admin 维护钉钉群 webhook URL + sign secret + 启停 + 测试推送按钮 |
| FR-108 | 数据可视化（最小） | `/briefing/[id]` 详情页展示当日 + 过去 7 日核心字段折线（沪铜主力 / 碳酸锂主力 / USD / 仓单），用 Recharts |
| FR-109 | 缺失数据降级 | 任一字段拉取失败标 `null`，简报渲染时用 "—" 或"详见 Wind"占位；连续 3 个工作日同字段为 `null` 触发 admin Dashboard 黄色告警 |
| FR-110 | 简报回看导出 | 任一历史简报可下载 docx；超过 90 天的简报 docx 已被 MinIO retention 清理，下载返回 410 Gone（与 base NFR-03 一致）|

### 3.2 v1.1 MVP 不做（明确排除）

- 自动锁价 / 采购下单（合规底线，绝不触碰）
- TC 加工费 / 锂矿指数（884785.WI）等付费 Wind 数据自动抓取（采购采订后另立 v1.2 task）
- 个人微信群推送（无合规 API；如需，由人工手动转发）
- 周报 / 月报（v1.2+）
- 价格预警（"沪铜跌破 70000 通知"，v1.2+）
- 多商品扩展（仅铜锂；扩到钢/铝/铅锌走 v1.2 横切设计）

### 3.3 v1.1 显式延后到 v1.2 的需求登记

| 候选 | 推迟原因 |
|---|---|
| TC 加工费 / Wind 锂矿指数自动接入 | 需采购 SMM / Wind 数据包，走另一条采购流程 |
| 多商品扩展（钢 / 铝 / 铅锌） | v1.1 锁定铜锂跑通，避免提早泛化 |
| 价格预警 / 阈值告警 | 与 v1.0 `alert_type` 多通道复用方案需要更多论证 |
| 周报 / 月报 | 16:00 简报跑稳定后再考虑 |
| 邮件 / 企业微信 / Telegram 推送 | 钉钉群覆盖目标用户，其他渠道按需在 v1.2 评估 |

---

## 4. 非功能需求 (NFR)

| NFR | 指标 |
|---|---|
| NFR-101 性能 | 单次简报端到端生成 ≤5 分钟（拉数 + LLM 生成 + docx 渲染 + 推送）；高峰拉数并发不影响 v1.0 fetcher 主流程（独立 BullMQ 队列） |
| NFR-102 准确性 | 数值字段以交易所官方接口为准；非官方源（RSSHub 抽数值）必须留 raw_text 字段便于人工复核；任何"AI 抽取数值"路径**全部禁止** |
| NFR-103 数据保留 | `commodity_quotes` 时序数据保留 **365 天**（超 v1.0 默认 90 天，因价格历史的研判价值高）；`commodity_briefings` 元数据 + docx 路径保留 90 天，docx 文件本身随 MinIO retention（≤90 天）|
| NFR-104 可观测 | 简报生成 P50/P99 时长、字段缺失率、推送成功率三项接入 Grafana（沿用 v1.0 dashboard） |
| NFR-105 成本 | Kimi K2.6 简报生成单次 ≤ 4 元 / 月度 ≤ 100 元（约 22 工作日）；并入 v1.0 NFR-05 LLM 总预算管控 |
| NFR-106 推送失败兜底 | 钉钉机器人 webhook 失败 3 次后停止重试 + admin Dashboard 红色告警；不阻塞下一日简报生成 |
| NFR-107 模板可编辑 | docx 模板字段映射存数据库 `briefing_template_fields` 表（key + label + source_query + placeholder），admin 可后台编辑映射，无需发版 |

---

## 5. 信源补充

### 5.1 T1 权威一手（追加到 v1.0 `sources` 表）

| 信源 | 类型 | 用途 |
|---|---|---|
| 广州期货交易所 - 行情数据 | API/HTML | 碳酸锂主力 / 仓单 |
| 上海期货交易所 - 行情数据 | API/HTML | 沪铜主力 / 库存周报 |
| LME - 官方延迟数据 | HTML | 伦铜价 |
| 中国人民银行 - 汇率中间价 | HTML | USD/CNY 中间价 |
| 中国货币网 - 国债收益率 | HTML | 10Y 国债收益率 |
| 国家统计局 - PMI（月度）| RSS | PMI 发布提醒 + 抓数值 |
| 海关总署 - 进出口数据（月度）| RSS | 铜精矿 / 碳酸锂进口量发布提醒 |

### 5.2 T2 头部行业媒体（通过自部署 RSSHub 包装）

| 信源 | RSSHub route 示例 |
|---|---|
| SMM 上海有色 - 铜资讯 | `/smm/news/cu` |
| SMM 上海有色 - 锂资讯 | `/smm/news/li` |
| 生意社 - 现货报价（铜 / 碳酸锂） | `/100ppi/price/cu` / `/100ppi/price/li2co3` |
| 长江有色 - 铜价 | `/ccmn/price/cu` |
| 中汽协 - 动力电池装车量（月度）| `/caam/data/battery` |

### 5.3 T3 综合财经媒体（已在 v1.0，复用）

财联社、金十数据电报、雪球关键词订阅"碳酸锂""电解铜"（v1.0 已有信源，按现有规则抓取，铜锂相关条目自然命中评分 pipeline，可作为"行情逻辑总结"的 context 喂给 Kimi）。

### 5.4 信源约束

- 全部 v1.1 新增信源走 `sources` 表 admin CRUD 录入，禁止硬编码 URL
- 遵守 base requirements §12 数据合规：UA "FE-Radar Bot" / 同站 ≥1s 间隔 / robots.txt / 代理池仅绕 IP 封禁不绕 robots
- RSSHub 自部署的本地 instance（`http://rsshub:1200`）走内网 / 不暴露公网

---

## 6. 数据指标清单（铜锂指标分层）

> 完整字段映射见 §7。本节按"获取难度 × 更新频率"分层，对应 §3.1 FR-109 缺失降级策略。

### 6.1 第一层：T1 高频数值（每日必拿）

| 指标 | 来源 | 频率 |
|---|---|---|
| 沪铜主力合约价 + 涨跌 | 上期所 | 日（15:00 收盘后） |
| 广期所碳酸锂主力价 + 涨跌 | 广期所 | 日 |
| LME 伦铜 | LME 延迟 / 投网代理 | 日 |
| 1# 电解铜现货均价 | SMM RSSHub | 日 |
| 电池级碳酸锂现货均价 | SMM RSSHub | 日 |
| 升贴水 / 期现基差 | 代码计算（现货 - 期货） | 日 |
| USD/CNY 中间价 | 央行 | 日 |
| 10Y 国债收益率 | 中国货币网 | 日 |
| 广期所碳酸锂仓单 | 广期所 | 日 |

### 6.2 第二层：T2 周度 / 月度（更新到则更新，否则展示上期值）

| 指标 | 来源 | 频率 |
|---|---|---|
| 上期所铜库存 | 上期所周报 | 周（周五） |
| 制造业 PMI | 国家统计局 | 月 |
| 动力电池装车量 | 中汽协 | 月 |
| 铜精矿月进口量 | 海关总署 | 月 |
| 纯碱市场均价 | 生意社 RSSHub | 周 |

### 6.3 第三层：付费 / 难拿（v1.1 标注"详见 Wind / 待补"，留位不阻塞）

| 指标 | 计划 |
|---|---|
| 铜矿 TC 加工费 | v1.2 评估 SMM 数据包采购 |
| 锂矿指数 884785.WI | v1.2 评估 Wind API |
| 6% 品位锂精矿价格 | v1.2 评估 Fastmarkets |
| 国内线缆开工率 / 锂电产业链开工率 / 盐湖提锂开工率 / 港口锂矿库存 | v1.2 评估 SMM 数据包 |

### 6.4 缺失降级原则

- 第一层任一字段拉取失败 → 当日简报继续生成，该字段标 "—"，但记 admin Dashboard 黄色告警；连续 3 工作日失败 → 红色告警
- 第二层字段未到更新窗口 → 展示"上期值（YYYY-MM-DD）"
- 第三层字段固定显示"详见 Wind / 待补"，不触发告警

---

## 7. 简报模板字段映射

> 模板基线为用户上传的 `铜锂大宗商品·每日行情简报.docx`，包含两大品种段（CU / LC）+ 宏观段 + 综合段 + 风险段 + 采购实操段。本节定义 docx 占位符 → 数据源映射的规则；具体表存 `briefing_template_fields`（NFR-107），admin 可后台改。

### 7.1 占位符命名规范

`{{<commodity>.<group>.<metric>}}`，例如：
- `{{cu.price.shfe_main}}` 沪铜主力
- `{{cu.price.shfe_main_change}}` 涨跌
- `{{lc.indicator.lithium_index}}` 锂矿指数（v1.1 渲染为"详见 Wind"）
- `{{macro.usd_cny_mid}}` 央行中间价
- `{{cu.analysis.logic_summary}}` LLM 生成的"当日行情逻辑总结"
- `{{cu.outlook.support}}` / `{{cu.outlook.resistance}}` / `{{cu.outlook.trend}}` LLM 生成的支撑/压力/趋势判定

### 7.2 LLM 生成段落（共 7 段，对齐 `design.md §6.1` BRIEFING_SCHEMA）

| 占位符 | 类型 | 提示词约束 |
|---|---|---|
| `{{cu.analysis.logic_summary}}` | string ≤200 字 | 输入当日全部 CU 数值 + 24h 内 C1/C2 命中的铜相关 items 摘要 → 输出逻辑总结 |
| `{{cu.outlook.trend}}` | enum 三选一 | 输入近 5 个交易日 CU 主力序列 + 当日逻辑总结 → "偏多" / "区间震荡" / "偏弱" |
| `{{lc.analysis.logic_summary}}` | string ≤200 字 | 同上，碳酸锂 |
| `{{lc.outlook.trend}}` | enum 三选一 | 同上，碳酸锂 |
| `{{macro.summary}}` | string ≤150 字 | 输入 USD/CNY 中间价 + 10Y 国债 + 当日 macro 类 items 摘要 → 输出宏观总结 |
| `{{risk_notes[]}}` | string array ≤5 项 | 输入两品种 logic_summary + 近期事件摘要 → 输出 ≤5 条风险提示，每条 ≤100 字 |
| `{{procurement_advice}}` | enum 四选一 | 输入两品种 trend → §7.3 4 选 1 采购建议 |

**支撑位 / 压力位代码计算**：`{{cu.outlook.support}}` / `{{cu.outlook.resistance}}` / `{{lc.outlook.support}}` / `{{lc.outlook.resistance}}` 由 `packages/core/briefing.ts:computeSupportResistance()` 基于近 20 个交易日 high/low + pivot 算法在 worker 装配层算出，注入 `commodity_briefings.payload_json`。**LLM schema 不含 support/resistance 字段**，避免 LLM 输出数值导致幻觉。

**禁止 LLM 输出数值字段**（任何带数字的占位符都来自 quotes 表 / 代码计算）。

### 7.3 综合段（六、原材料采购实操建议）

为 4 项预置选项之一（与模板一致）：
- 全面观望，等待价格回落
- 刚需少量补库，大批量采购暂缓
- 逢关键支撑位分批锁价备货
- 严控现有库存，放缓整体备货节奏

由 Kimi 根据"两品种当日趋势判定 + 库存水平"四选一（schema-constrained JSON），不允许自由发挥。

---

## 8. 推送策略

### 8.1 推送渠道（v1.1 MVP）

- ✅ **钉钉群机器人 webhook**（加签 / IP 白名单二选一，admin 配置）
- ✅ **站内 `/briefing` 页**（默认入口）
- ❌ **MVP 不发邮件 / 企微 / Telegram**（v1.2+）

### 8.2 推送时间

- 16:05 Asia/Shanghai（在简报 16:00 生成完成后 5 分钟内）
- 仅工作日（周一至周五，跳过节假日表）
- 节假日表 `briefing_holidays` 由 admin 一年一次手工维护（v1.1 接受手工，v1.2 评估接入第三方节假日 API）

### 8.3 推送内容

钉钉 actionCard 消息卡片（v1.1 MVP 唯一推送形式）：
- 标题：`远东·铜锂行情简报 · YYYY-MM-DD`
- 摘要 markdown：当日两品种核心数据 1 行 + 趋势判定 + 落款"FE-Radar"
- 单按钮：`查看完整简报` → 站内深链 `https://<intranet>/briefing/<id>`（用户凭已登录态点击进站内详情页下载 docx）

**不直接推送 docx 文件**：钉钉自定义机器人不支持原生 file 消息；MinIO 内网部署不向钉钉公网回调暴露。v1.2+ 评估是否接入企业内部机器人 + 文件 API（依赖管理员审批 + 额外开发量，不在 v1.1 范围）。

### 8.4 推送失败兜底

- HTTP 5xx / 钉钉错误码 → 指数退避重试 3 次
- 3 次仍失败 → 写 `briefing_pushes.push_status='failed'` + admin Dashboard 红色告警
- admin 可在 `/briefing/[id]` 点"重新推送"手动重试
- 不阻塞下一日简报生成

---

## 9. 数据合规

### 9.1 沿用 v1.0 约束

- 不存原始 HTML 快照（requirements §12 / FR-12）—— v1.1 不破坏
- 公网 LLM 调用前必经 `packages/core/scrubber.ts`（requirements §12 v0.7 R1）—— v1.1 Kimi 调用同样过 scrubber
- 用户反馈数据 90 天保留 —— v1.1 简报评论功能不在 MVP，不涉及

### 9.2 v1.1 新增约束

- **价格数据合规**：仅抓取交易所官方公开延迟数据（不订阅实时行情 feed，避免触发交易所行情授权要求）
- **数值精度审计**：每个 quote 写入时必须带 `source_id` / `raw_text` / `observed_at`，用于事后人工复核
- **`raw_text` 是脱标文本摘要 ≤2000 字符**（已 strip HTML 标签 / 仅保留与数值相关的最小上下文），**不得存储完整 HTML**（沿用 v1.0 FR-12 不存原始 HTML 快照硬约束）；RSSHub 等非官方源正则未命中时同样裁剪后落库
- **简报内部使用声明**：docx 模板页脚固定文字"仅供远东控股内部决策参考，禁止外传 / 不构成投资或采购建议"

---

## 10. 与 v1.0 关注圈 / 实体词典对接

### 10.1 关注圈复用

v1.0 关注圈 C2 已含上游：江西铜业、铜陵有色、云南铜业、宁德时代、比亚迪、亿纬锂能、国轩高科。v1.1 不修改名单，**仅追加产品类实体**（不属于 company 类，无 circle 字段）：
- `product`：电解铜 / 1# 电解铜 / 阴极铜 / 电池级碳酸锂 / 工业级碳酸锂 / 铜精矿 / 锂精矿 / 锂辉石 / 锂云母 / 碳酸锂 / 氢氧化锂
- `product`：YJV / YJV22 / YJLV / 储能电芯（沿用 v1.0 NER 命中规则）

### 10.2 信源 tier 配置

新增信源按 §5 分层录入 `sources.tier`：T1=广期所/上期所/央行/统计局/海关；T2=SMM/生意社（RSSHub 包装）/长江有色/中汽协；T3=不新增。

### 10.3 不破坏的字段

`sources.fetcher_type` v1.0 CHECK 仅含 `('rss','html','playwright')`。本模块**新增** `'quotes'` 选项需要 ALTER CHECK，作为 v1.1 唯一一次破坏性 schema 改动；详见 `design.md §7` + `tasks.md T-CB-02` 的 migration 设计。

---

## 11. 决策记录 / 待决问题

### 11.1 已决策（本轮 Plan 内）

| # | 问题 | 决策 |
|---|---|---|
| Q-11A | 推送渠道 MVP | ✅ 仅钉钉群机器人，其他 v1.2+ |
| Q-11B | docx 模板字段映射存储 | ✅ `briefing_template_fields` 表，admin 可后台改 |
| Q-11C | 数据保留 | ✅ quotes 365 天 / briefings 元数据 90 天 / docx 文件随 MinIO retention |
| Q-11D | 非交易日处理 | ✅ 周末 + 节假日表跳过；节假日表手工维护 |
| Q-11E | 数值 LLM 抽取 | ✅ 绝对禁止；只允许交易所接口 + 正则 |
| Q-11F | 商品扩展 | ✅ v1.1 锁定铜锂；钢/铝走 v1.2 横切设计 |
| Q-11K | 钉钉推送形式（v0.2 决策） | ✅ actionCard 摘要 + 站内深链；不发原生 docx 文件（自定义机器人限制 + MinIO 不出公网），v1.2 评估企业机器人 |
| Q-11M | LLM 段数（v0.2 决策） | ✅ 7 段全 LLM 产出（与 BRIEFING_SCHEMA 对齐：CU/LC × {logic_summary, trend} + macro_summary + risk_notes + procurement_advice） |
| Q-11N | 支撑位/压力位（v0.2 决策） | ✅ 代码计算（packages/core/briefing.ts，基于近 20 交易日 high/low+pivot），LLM 不参与；schema 不含 support/resistance |
| Q-11G | 钉钉群机器人凭据来源（v0.3 决策） | ✅ **候选 B**：由信息中心新建专用群机器人（与采购日常群隔离 · 权限边界清晰 · 凭据轮换审计独立）；交付：信息中心提供 webhook URL + sign_secret 写入 Docker Swarm secrets（不入 git）· admin 后台 [DMA-175](https://linear.app/dmarkubex/issue/DMA-175) `/admin/briefing/targets` 录入；现有采购群机器人 v1.2 评估再合并 |
| Q-11H | docx 模板基线（v0.3 决策） | ✅ **候选 A**：以用户 2026-05-19 上传的 `铜锂大宗商品·每日行情简报.docx` 为基线（占位符已对齐 §7.1）；模板纳入 git `design/templates/briefing.docx`；不允许运行时上传；模板结构变更走 PR + lint |
| Q-11I | 16:00 推送时间（v0.3 决策） | ✅ **接受 16:00**：日盘收盘价（15:00）+ 现货早盘报价，符合大多数采购 / 销售场景的时效需求；夜盘版（21:30 含全结算价）推迟到 v1.2 评估；模板字段加注"日盘收盘价 · 夜盘见次日简报"对齐 |
| Q-11J | 节假日表初始数据（v0.3 决策） | ✅ **候选 A**：admin 人工录入 2026 全年 11 天法定节假日（[DMA-158](https://linear.app/dmarkubex/issue/DMA-158) T-CB-03 seed 0009 兜底；后续每年 admin 自助维护）；外部日历同步推迟到 v1.2 评估 |
| Q-11L | LLM 月度成本预算（v0.3 决策） | ✅ **计入 v1.0 NFR-05 ≤500 元总预算**：v1.1 Kimi 月度 ≤100 元（NFR-105）与 v1.0 现有 LLM 成本共享 500 元红线；Grafana 共用一根总线告警（[DMA-176](https://linear.app/dmarkubex/issue/DMA-176) T-CB-19 仪表盘按"总额 + 拆分"两栏展示）|

### 11.2 待用户确认（阻塞 Antigravity Plan Review）

> v0.2 5 个待决问题（Q-11G/H/I/J/L）已于 2026-05-19 全部 Human-decision 内化到 §11.1，本节当前**为空**。
> Audit trace：Linear [DMA-152 V11-Q](https://linear.app/dmarkubex/issue/DMA-152) 评论留底。

---

## 12. 验收标准（共 12 项）

- [ ] §3.1 全部 FR-101..110 可演示
- [ ] 第一层 9 项数值字段（§6.1）每日成功率 ≥ 95%（连续 5 工作日观察）
- [ ] 第二层 5 项周/月度字段更新窗口对齐发布日，无数据时降级展示上期值
- [ ] 简报 docx 端到端生成时延 P95 ≤ 5 分钟
- [ ] 推送成功率 ≥ 95%（5 工作日观察）
- [ ] LLM 生成段落人工抽检"无数值幻觉"100%（5 工作日 × **7 段** = 35 段；7 段 = CU/LC logic_summary + CU/LC trend + macro_summary + risk_notes + procurement_advice）
- [ ] 支撑位/压力位代码计算回测：近 20 交易日 high/low + pivot 公式与人工标注吻合度 ≥ 90%
- [ ] 节假日跳过：`briefing_holidays` 含当日 → quotes-fetch / briefing-gen / briefing-push 三个 job 全部 early-return（结构化日志记录，零数据库写入）
- [ ] FR-110 简报回看：≤90 天 docx 可下载 200；>90 天 docx 已 retention 清理时返回 **410 Gone**（不是 404）
- [ ] 钉钉机器人凭据安全三层防御：API 响应 `sign_secret` mask 为 `***` / Pino 日志对 `webhook_url`+`sign_secret` redact / Admin UI 输入框 `type=password`
- [ ] 与 v1.0 base：未修改 v1.0 已有字段 / 表 / API / 路由（schema migration diff 仅含 v1.1 新表 + `sources.fetcher_type` CHECK 扩展 + `sources-schema.ts` 扩展 fetcher_type enum）；v1.0 已有 86 tests 全绿
- [ ] Antigravity Plan Review pass + Antigravity Code Review 无 Critical

---

## 13. 后续动作

1. ✅ **用户评审 v0.1**（Q-11G..L 决策） → v0.2（含 Q-11K/M/N 决策）
2. ✅ **生成 `design.md` 与 `tasks.md`** v0.2 DRAFT
3. ✅ **Human-decision v0.2 待决 5 项** (Q-11G/H/I/J/L) → v0.3（2026-05-19）
4. ✅ **建 Linear issue**（28 条 DMA-151..178 · 全部 Backlog · 39 条 blockedBy 已设）
5. **提交 Antigravity Plan Review**（[DMA-153 V11-REVIEW](https://linear.app/dmarkubex/issue/DMA-153) · requirements + design + tasks 一次性 · 沿用 v1.0 DMA-24 节奏）
6. **Fix Plan**（如有 Critical / Major） → v0.4
7. 等 v1.0 release tag v1.0.0 GA → [DMA-154 V11-P1](https://linear.app/dmarkubex/issue/DMA-154) 升 Todo → Codex Execute T-CB-01..08
