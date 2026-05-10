# FE-Radar — Requirements (v0.8 DRAFT)

> **v0.8 changelog (Antigravity 第二轮 Stage 4 Audit fix · 2 Systemic + 1 Edge)**：
> - **R1**：§10.4 删除 step 2 "钉钉手机号匹配自动合并"（钉钉 OAuth 不返回手机号，原路径自相矛盾）；改为 step 2 = "name+dept 唯一匹配本地账号 → 自动合并；多个候选 → admin manual"
> - **R2**：design.md §8 `users` 表加 `disabled_at`（软删/停用）；T-M5-03 用此字段实施"删除（停用）"
> - **E1**：design.md §9 `/api/items/:id` 默认拒绝 quota_state ∈ block / pending / dropped 的 item，避免 detail API PII leak

> **状态**：DRAFT · 所有 §13 决策已 closed · Antigravity DMA-23 评审 fix 已落地（v0.7）· 待 Antigravity 复审
> **最后更新**：2026-05-08
> **作者**：Claude Code（Plan Stage 产出）
> **审阅流程**：Human Review → 产出 spec/tasks.md → Antigravity Plan Review → Fix Plan → Execute
>
> **v0.7 changelog (Antigravity DMA-23 Fix · 3 Critical + 3 Edge)**：
> - R1（外部 LLM 泄密）：§12 新增"调 LLM 前必经 scrubber 脱敏"约束；NFR-04 安全表加敏感数据脱敏行
> - R2（账号合并）：§10 新增 §10.4 合并策略（dingtalk_id 与本地 username 合并键 + 冲突处理）
> - R3（爬虫抗封锁）：§11 部署约束加代理池子项（用于 T1 政府类信源失败重试）
> - E1/E2/E3 在 design.md / tasks.md 落地（embedder 索引选型 / cluster 锁 / priority 饥饿监控）
>
> **v0.6 changelog (DMA-20 Symphony 复复复评 fix · 2 Major + 1 Minor)**：
> - F1 fix：handoff.md §1/§5/§7 残留 v0.4/DMA-19 文本全部刷新到 v0.5/DMA-20，§7 next owner 改为 Claude Code
> - F2 fix：requirements.md §0 / §13 标题 / 文末后续动作 + design.md §17 全部从"开放问题/必须解决"措辞改写为"决策记录"，体现 Q-A…Q-K 已 closed
> - F3 fix（minor 占位）：design.md §9 API 表加 admin backlog drill-down endpoint 占位（实际实现并入 M5 admin 后台 task）
>
> **v0.5 changelog (DMA-19 Symphony 复复评 fix · 4 Major + 1 Minor)**：
> - F1 fix：design §8 `feedbacks.item_id` 加 `ON DELETE CASCADE`，使 cleanup 事务不被 FK 阻塞
> - F2 fix：design §5.1 `admitToScoring()` 改双独立 Redis 计数器（`normal_used`≤1300 + `priority_used`≤200），仅在成功 admit 时 incr，用 Lua 原子化
> - F3 fix：NFR-01 + design §5.1 加 backlog 老化策略（max_age 7 天 → `dropped_quota_expired` 状态）；§8 `quota_state` CHECK 加新值；§14 Dashboard 加 backlog 行
> - F4 fix：handoff.md §2/§4/§7 重写消除 v0.1 stale Human-stop block；design §18 next steps 移除"解决 §13 开放问题"
> - F5 fix：design §8 scoring_config seed 块旁加"insert-only / 不覆盖 admin 配置"说明
>
> **v0.4 changelog (DMA-18 Symphony 复评 fix · 6 Major + 2 Minor)**：
> - F1 fix：design §8 增加 `scoring_config` INSERT seed（权重/阈值/t_coef/c_coef）
> - F2 fix：§9 policy alert 改用 NER 独立类型 `policy`（不再用错误的 `event_type=政策`）；design §11 computeAlert() 同步
> - F3 fix：NFR-01 限速器改为**优先级配额**：保留 200/天给 C1/own/safety/policy；普通条目超 1500 标 `pending_over_quota` 进 backlog 下窗口处理（保 "自家公司告警零漏报" 验收）
> - F4 fix：design §8 `clusters.lead_item_id` 加 `ON DELETE SET NULL`；§14 cleanup job 加 `daily_reports` 90 天清理
> - F5 fix：design §8 users CHECK 收紧为"完整凭据"约束
> - F6 fix：design §18 + handoff.md 控制状态更新到 v0.3/DMA-18（移除 v0.2/DMA-17 残留）
> - F7 fix：design §9 API 表补 `/api/alerts?type=&level=&source=` + `/api/alerts/count`
> - F8 fix：design changelog 移除 `raw_html` 字面残留
>
> **v0.3 changelog (Q-D/E/F/G/H/I/J/K 决策内化 · DMA-7…DMA-16 反馈)**：
> - Q-K（DMA-16）选 A：1500 = 日上限；调度加日配额限速器
> - Q-F（DMA-9）+ Q-J（DMA-13）：钉钉 SSO 推后到 M4；M0–M3 用本地账号（用户名+密码）登录；admin 通过 SQL seed 预置
> - Q-I（DMA-12）：全部数据保留 90 天（含元数据 / content / 分析结果 / 用户反馈）；不引入 DMCA 删除接口
> - Q-H（DMA-11）选 C：alert_type 字段多通道（own / safety / policy）+ /alerts 页 type 筛选
> - Q-D（DMA-15）+ Q-E（DMA-8）：接受默认权重与阈值（写入 scoring_config）
> - Q-G（DMA-10）选 A：MVP 不做营销软文识别
> - Q-B（DMA-7）：C1/C2 名单暂保持现状
> - Q-C（DMA-14）：Claude Code 提供候选信源清单 → 用户筛选 → 录入 `sources` 表（仍未 close）
>
> **v0.2 changelog (Symphony DMA-6 评审 fix · 历史)**：
> - Finding 1 fix：§14 后续动作顺序修正（tasks.md 在 Plan Review **之前**，符合 AI_index Full Mode）
> - Finding 2 fix：NFR-01 吞吐定义澄清；增加 Q-K 开放问题
> - Finding 3 fix：§10.2 不拉 mobile；§12 移除"原始 HTML 90 天"；NFR-03 与 §12 对齐

---

## 0. 评审说明

按 AI Coding Kernel Full Mode 流程，本文档处于 Plan 阶段第一轮人评审。
- 文末 §13 是 **决策记录（Q-A…Q-K · 历史 · 已全部 closed）**，供后续追溯，不再阻塞 Antigravity Plan Review。
- 所有数值、阈值、名单均为初稿，可改。
- 文档约束本项目的 **WHAT**（要做什么）；**HOW**（怎么做）见 `spec/design.md`。

---

## 1. 产品定位

**FE-Radar**：远东控股集团内部使用的电力 / 电线电缆 / 储能 / 能源行业**产业情报雷达**。

**一句话**：每 6 小时抓一遍全网行业动态，过滤、评分、聚类后，以**时间线 + 精选 + 日报**形式呈现，辅助高层、市场、销售、研发、品牌团队的日常决策。

**两条产品哲学**（贯穿设计）：
1. **信源比信息重要** —— 基于 AI 时代的信息黑暗森林法则，先精选信源，再处理信息。
2. **能用脚本就别用 Agent** —— LLM 只做语言任务（评分原子分、摘要、翻译、NER），分类、权重、阈值、聚类策略全部用代码控制，确保可控、可调、可回测。

---

## 2. 用户与场景

**规模**：500 人内部使用（钉钉 SSO，企业账号）。

**4 类典型角色与其重度使用功能**：

| 角色 | 重度功能 | 关心的信号 |
|---|---|---|
| 高层 / 战略 | 日报、精选 Tab | 政策、价格、竞品订单、行业并购 |
| 市场 / 销售 | 关键词筛选、搜索 | 招投标、客户动态、地区项目 |
| 研发 / 技术 | 分类筛选（技术板块） | 新材料、新工艺、新国标 |
| 公关 / 品牌 | 自家公司告警 | "远东"被谁报道了、舆情正负面 |

---

## 3. 功能需求 (FR)

### 3.1 MVP 必须有（M0–M5 范围）

| FR | 功能 | 描述 |
|---|---|---|
| FR-01 | 时间线 | 按时间倒序展示所有 Item，支持分页/虚拟滚动 |
| FR-02 | 精选 Tab | 只展示过质量分阈值且为事件主条的 Item |
| FR-03 | AI 日报 | 每天 08:00（Asia/Shanghai）自动生成，5 版块 |
| FR-04 | 事件聚类 | 同一事件折叠，显示主条 + 关联条数，可展开 |
| FR-05 | 关键词 / 分类筛选 | 按 类型 / 信源 / 关注圈 / 项目类型 过滤 |
| FR-06 | 全文搜索 | 中英双语；范围 = 标题 + 摘要 + 实体 |
| FR-07 | 自家公司告警 | "远东"被提及条目置顶高亮，独立告警页 |
| FR-08 | 本地账号登录（M0–M3）| 用户名+密码登录；admin 账号通过 SQL seed 预置；密码 bcrypt 散列存储 |
| FR-08a | 钉钉 SSO 登录（M4+） | 接入公司现有钉钉开放平台应用；与本地账号并存 |
| FR-09 | 信源管理后台 | 信源 CRUD，分级 T1/T2/T3，可启用/禁用 |
| FR-10 | 实体词典后台 | 维护 C1/C2/C3 公司、产品、政策实体 |
| FR-11 | 反馈机制 | 用户对单条 +1/-1 + 文本备注；后台可查看 |
| FR-12 | 原文跳转 | 点击标题跳转第三方原文；MVP **不抓快照**，按用户决定 |

### 3.2 MVP 不做（明确排除）

- 邮件 / 钉钉消息 / Telegram 推送（M5+ 再考虑）
- 个性化推荐 / 协同过滤（用户历史行为驱动）
- 趋势预测 / 热度图表
- 站内原文阅读器（快照 HTML）
- 多语种 UI（仅中文）
- 自动化选题建议

---

## 4. 非功能需求 (NFR)

| NFR | 指标 |
|---|---|
| NFR-01 性能 | **日上限 ≤1500 条 LLM 评分预算**（Q-K 决策 A），分布在 4 轮（00:00 / 06:00 / 12:00 / 18:00 上海时区）；单轮端到端处理 ≤30 分钟。**预算切分**：1300 给普通条目（双独立计数器 `normal_used`），200 保留给"高优先级"（C1 自家命中 / `event_type=事故` / NER `policy` 类型命中，独立计数器 `priority_used`）。**Backlog 老化**：超额条目标 `pending_over_quota` 进 backlog，下个窗口余额优先消化；超过 7 天仍未消化转 `dropped_quota_expired` 终态（避免无限累积爆 PG），并在 admin Dashboard 触发告警。|
| NFR-02 可用性 | 内部使用，目标 99.5%（不追 4 个 9） |
| NFR-03 数据保留 | **全部数据保留 90 天**（Q-I 决策）：Item 元数据 / content / 分析结果（评分/摘要/实体/embedding）/ 用户反馈数据，过期自动清理；不留原始 HTML 快照（与 FR-12 对齐） |
| NFR-04 安全 | 仅内网访问，钉钉 SSO，最小权限原则 |
| NFR-05 成本 | LLM API 月度成本控制在 ≤500 元（DeepSeek/Kimi 计），本地 Qwen 不计 |
| NFR-06 可观测 | Worker 任务进度、抓取成功率、LLM 调用量、聚类质量四项关键指标可见 |
| NFR-07 可回滚 | 评分公式参数化（数据库存储），调整无需发版 |

---

## 5. 关注圈 C1 / C2 / C3 配置

> **C 系数**：C1 = 1.20，C2 = 1.00，C3 = 0.85（在最终分公式里乘）

### 5.1 C1 核心圈（远东自身 + 核心客户 + 直接监管）

**自家公司**：
- 远东控股集团、远东电缆、远东智慧能源、远东智慧能源股份、远东股份

**核心客户 / 直接关系方**：
- 国家电网、南方电网（含 27 家省网）
- 国家能源局、国家发改委、工信部
- 五大发电集团（国家电投、华能、华电、大唐、国家能源集团）

### 5.2 C2 战略圈（主要竞品 + 关键上下游）

**主要竞品（电缆）**：
- 宝胜股份（宝胜电缆）
- 江南电缆（江苏江南电缆）
- 中天科技（中天电缆 / 中天海缆）
- 亨通光电（亨通电缆 / 亨通海缆）
- 起帆电缆
- 金杯电工

**关键上游**：
- 江西铜业、铜陵有色、云南铜业（铜杆）
- 宁德时代、比亚迪、亿纬锂能、国轩高科（电芯，储能 PACK 用）

**关键下游**：
- 国网各省公司（按省份单列）
- 大型房企：万科、保利、华润置地、龙湖、绿地（布电线渠道）
- 海风 / 光伏 / 数据中心 EPC：明阳智能、中国电建、中国能建
- 储能集成商：阳光电源、华为数字能源、科华数能、海博思创

### 5.3 C3 行业圈

电力 / 电缆 / 储能行业全部其他公司、协会、媒体、研究机构。

> ⚠ 上述名单为初稿，要求用户补充完整后存入 `entities` 表，作为可后台编辑的词典，不写死代码。

---

## 6. 信源分级 T1 / T2 / T3

> **T 系数**：T1 = 1.00，T2 = 0.85，T3 = 0.70

| 等级 | 类型 | 例子（待 Q11 补全完整清单） |
|---|---|---|
| **T1** 权威一手 | 政府、协会、上市公司公告、国标 | 国家能源局官网、发改委、工信部、中电联、中国电器工业协会、中国储能联盟、巨潮资讯（公告）、上交所 / 深交所披露 |
| **T2** 头部行业媒体 | 专业媒体 / 官号 | 北极星电力网、电缆网、储能网、电缆头条、储能头条、Wind 行业频道 |
| **T3** 普通信源 | 综合财经 / 自媒体 / 社交 | 财联社、界面、36氪 能源板块、雪球行业讨论、知乎大V |

> 👉 信源 RSS / URL 清单由用户在 Q11 阶段提供，导入 `sources` 表。

---

## 7. 5 维评分体系

### 7.1 5 个维度

| 维度 | 0–100 含义 | 评分者 |
|---|---|---|
| `D1_policy` 政策法规权重 | 涉及国标、政策、补贴、许可、规划的程度 | LLM（DeepSeek） |
| `D2_chain` 产业链关联度 | 触及 C1/C2/C3 实体的程度 | **代码**（基于 NER 命中实体） |
| `D3_market` 市场 / 价格信号 | 含价格、招投标金额、产能数据的程度 | LLM |
| `D4_tech` 技术 / 标准突破 | 新材料、新工艺、新国标、新认证 | LLM |
| `D5_business` 商业机会 / 风险 | 大订单、并购、财报、安全事故、关税、人事 | LLM |

> ⚠ **关键设计**：`D2_chain` 不让 LLM 主观打，使用 NER 命中规则**强制保证**自家公司被提到必有高分。

### 7.2 最终质量分公式

```
quality = (Σ Dᵢ × wᵢ) × T_coef × C_coef

其中：
  权重 wᵢ 在数据库 scoring_config 表中可调
  默认 w1=0.20, w2=0.25, w3=0.20, w4=0.15, w5=0.20
  T_coef ∈ {1.00, 0.85, 0.70}
  C_coef ∈ {1.20, 1.00, 0.85}
```

### 7.3 各类精选阈值（默认值，可调）

| 大类 | C1 阈值 | C2 阈值 | C3 阈值 |
|---|---|---|---|
| 政策与标准 | 55 | 60 | 65 |
| 市场与价格 | 55 | 60 | 70 |
| 技术与产品 | 55 | 65 | 75 |
| 项目与招投标 | 50 | 60 | 70 |
| 公司与资本 | 55 | 65 | 75 |

---

## 8. NER 7 类实体

| 类型 | 说明 | 用途 |
|---|---|---|
| `company` 公司 | 含别名归一化（"远东电缆" → "远东控股"） | 关注圈命中、公司维度聚合 |
| `product` 产品 / 型号 | 如 "YJV22 电缆"、"280Ah 储能电芯" | 产品维度聚合 |
| `policy` 政策 / 标准编号 | 如 "GB/T 12706"、"发改能源〔2024〕XX 号" | 政策追踪 |
| `region` 地区 | 省 / 市 / 海外国家 | 地区筛选 |
| `money` 金额 | 招投标 / 订单金额，标准化为元 | 量级筛选 |
| `event_type` 事件类型 | 招标/中标/财报/人事/事故/合作/发布 | 事件分类 |
| `project_type` **项目类型** | **海风、光伏、特高压、数据中心**（4 选 1，可多选；可扩） | 项目类型筛选与日报版块归类 |

**实现**：本地 Qwen3.6 27B + 公司词典联合抽取（词典优先匹配，LLM 补充未登录词）。

---

## 9. 自家公司提及告警

### 9.1 触发条件与 alert_type 多通道（Q-H 决策 C）

`item_analysis.alert_type` 字段记录告警类型（可空 = 非告警），共 3 类：

| alert_type | 触发规则 | UI 颜色 |
|---|---|---|
| `own` | NER 命中 C1 中"远东"系列实体（远东控股、远东电缆、远东智慧能源、远东股份等同义词组）| 红/橙/黄 三级（按信源 T1/T2/T3）|
| `safety` | NER `event_type=事故` 且 D5 ≥ 70 | 灰色 |
| `policy` | NER **`policy` 类型**实体命中（如 "GB/T 12706"、"发改能源〔2024〕XX 号"，见 §8 实体表）且 D1 ≥ 75 | 蓝色 |

> ⚠ `policy` 是 §8 NER 7 类中独立的实体类型（标准/政策编号），不要与 `event_type=政策` 混淆 —— `event_type` 的合法值见 §8（招标/中标/财报/人事/事故/合作/发布），不含"政策"。

`/alerts` 页提供 alert_type 与 alert_level 筛选；后续若需要新告警类型，扩展 alert_type 枚举即可，不新建表。

### 9.2 告警等级

| 等级 | 颜色 | 触发组合 | 站内表现 |
|---|---|---|---|
| **L1 Critical** | 红色 | T1 信源 + 远东 | 时间线置顶 24h；红色色条；告警页首位 |
| **L2 High** | 橙色 | T2 信源 + 远东 | 时间线高亮；橙色色条；告警页 |
| **L3 Notice** | 黄色 | T3 信源 + 远东 | 黄色色条；告警页 |

### 9.3 触达渠道（MVP）

- ✅ **站内**：导航栏 "今日提及" badge（数字 + 红点）
- ✅ **独立页**：`/alerts` 倒序时间线，可按等级过滤
- ❌ **MVP 不发钉钉消息**（M5+ 评估）

### 9.4 误报处理

用户在告警页对误报点 "不是远东" → 反馈入 `feedbacks` 表，每周 review 用于优化 NER 词典与 disambiguation 规则。

---

## 10. 认证（M0–M3 本地账号 / M4+ 钉钉 SSO）

### 10.0 阶段策略（Q-F + Q-J 决策）

- **M0–M3**：本地账号登录（用户名+密码，bcrypt 散列）。admin 通过 SQL seed 预置（数据库 init 脚本里 INSERT 首批 admin）。M0 起即可使用，不阻塞前端开发与内测。
- **M4+**：接入钉钉 SSO（按 §10.1）。与本地账号并存：原有本地账号可继续登录，新用户走钉钉。

### 10.1 钉钉接入方式（M4+）

使用**远东集团现有的钉钉开放平台应用**（不新建）。需要管理员提供：
- AppKey / AppSecret
- 企业 CorpID
- 回调域名加白名单（内网域名）

### 10.2 登录流程

钉钉扫码登录 → 获取 unionid → 后端换 access_token → 拉用户基本信息（**仅 name、dept**；不拉手机号，遵从 §12 数据最小化）→ 写入 `users` 表 → 颁发本站 JWT。

### 10.4 账号合并策略（v0.7 R2 fix）

钉钉 SSO 上线（M4+）后会出现"同一员工已有 M0–M3 本地账号 + 首次钉钉登录"场景。合并按以下匹配键（优先级顺序，v0.8 简化）：

1. `users.dingtalk_id == unionid` → 直接登录，无合并
2. `name + dept` 完全匹配且 `dingtalk_id` 为空：
   - **唯一匹配** → 自动合并到本地账号，保留 role + feedbacks，写 audit log
   - **多个候选** → 写 `merge_conflicts` 表 + admin Dashboard 通知，同时新建 dingtalk-only 兜底（避免登录卡死），等 admin 在 `/admin/users` 手动 confirm
3. 其他 → 新建 dingtalk-only 账号，role 默认 viewer

> **v0.8 R1**：删除 v0.7 的 "钉钉手机号 hash 匹配" 路径 —— 钉钉 OAuth 不返回手机号（§10.2 + §12 数据最小化原则），原 mobile_hash 路径理论上永不命中，移除避免实施层误导。

**保留字段**：合并后 role 取 max（避免降权），created_at 取 min，feedbacks / audit log 全保留。
**实施**：详见 `spec/tasks.md` T-M4-05a + `design.md §10c`。

### 10.3 权限模型（MVP 简化）

| 角色 | 权限 |
|---|---|
| `viewer`（默认）| 浏览、搜索、反馈 |
| `editor` | + 信源 / 实体词典编辑 |
| `admin` | + 评分公式参数、阈值调整、用户角色管理 |

> 角色由 admin 在后台手动指派；MVP 不做基于钉钉部门的自动映射。

---

## 11. 部署约束

| 项 | 约束 |
|---|---|
| 编排 | Docker Swarm（通过 Portainer 管理） |
| 网络 | **仅内网访问**，不暴露公网 |
| 存储 | 自建 Postgres（含 pgvector）、Redis、MinIO（对象存储） |
| LLM | 本地 Qwen3.6 27B（已部署）+ DeepSeek API + Kimi K2.6 API |
| 备份 | Postgres 每日全备到 MinIO，保留 30 天 |
| 资源预估 | 8 个 service，整体内存 8–12 GB，CPU ≤4 核 |

---

## 12. 数据保留与合规（Q-I 决策）

- **不存储原始 HTML 快照**（与 FR-12、§3.2 对齐）。抓取流程仅在内存中解析 HTML，提取 `title + content(纯文本)`，原始 HTML 解析后立即丢弃
- **以下数据统一保留 90 天，过期自动清理**：
  - Item 元数据（url、title、content、published_at、source_id）
  - 分析结果（评分、摘要、实体、embedding）
  - 用户反馈数据（vote、reason）
- **永久保留**：信源配置（`sources`）、实体词典（`entities`）、评分配置（`scoring_config`）、用户账号（`users`）—— 这些是配置型数据，不属"内容"
- 不引入"应权利人要求即时删除"接口（DMCA-like）—— Q-I 决策不需要
- 不存储任何用户个人敏感信息（仅钉钉 unionid + name + dept；不存手机号）
- 抓取遵守目标站 robots.txt；UA 标识 "FE-Radar Bot"；同站请求间隔 ≥ 1s；禁用任何反爬绕过手段
- **代理池仅用于绕开 IP 封禁，不用于绕过 robots.txt**（v0.7 R3）：政府类 T1 信源被 IP 限速时切代理重试；robots.txt 解析仍生效；admin 后台 feature flag `PROXY_POOL_ENABLED` 可一键关
- **公网 LLM 调用前强制脱敏**（v0.7 R1）：所有送 DeepSeek/Kimi/本地 Qwen 的 payload 必经 `packages/core/scrubber.ts` 处理，识别 + 替换手机号 / 身份证 / 邮箱 / 内网 IP / 内部项目代号；命中明确 PII 阈值的条目跳过 LLM，进入 admin 待人工脱敏队列；详见 `spec/tasks.md` T-M2-14/15

---

## 13. 决策记录（Q-A…Q-K · 历史 · 已全部 closed）

> 本节是已完成决策的历史归档，不再阻塞下游流程。Linear DMA-7…DMA-16 是各条决策的具体讨论 issue。

| # | 问题 | 状态 |
|---|---|---|
| Q-A | 产品名最终用 "FE-Radar"，是否同意？ | ✅ 用户已确认 |
| Q-B | C1 / C2 名单是否完整，缺什么、漏什么 | ✅ 暂保持现状（DMA-7） |
| Q-C | T1 / T2 / T3 信源 RSS / URL 清单 | ✅ 用户确认按 37 条候选清单 v1 全采用（DMA-14 closed）|
| Q-D | 评分维度权重 w1..w5 默认值是否接受 | ✅ 接受默认（DMA-15）|
| Q-E | 各类精选阈值默认值是否接受 | ✅ 接受默认（DMA-8）|
| Q-F | 钉钉应用 AppKey / 回调域名 / 内网部署域名 | ✅ 用缓解方案 · M0–M3 本地账号 / M4+ 钉钉（DMA-9）|
| Q-G | "营销软文识别" / "反向扣分" 是否纳入 MVP | ✅ A 不做（DMA-10）|
| Q-H | "安全事故" 是否独立告警通道 | ✅ C 复用 alert_type 多通道（DMA-11）|
| Q-I | 数据保留期 12 个月是否合规要求 | ✅ 全部 90 天 · 无 DMCA 接口（DMA-12）|
| Q-J | 团队 admin 名单 | ✅ SQL seed 预置 admin · 与 Q-F 一致（DMA-13）|
| Q-K | NFR-01 中"1500 条"是单轮峰值还是单日上限 | ✅ A 日上限 · 加日配额限速器（DMA-16）|

---

## 14. 验收标准（MVP 上线条件）

- [ ] 12 个 FR 全部可演示
- [ ] 关注圈与信源词典可后台编辑（≥ C1+C2 名单录入完成）
- [ ] 至少 30 个信源持续运行 7 天，抓取成功率 ≥ 95%
- [ ] 5 维评分准确率（人工抽检 100 条 vs 系统精选）≥ 80%
- [ ] 自家公司告警零漏报（人工 case 测试）
- [ ] 日报已稳定生成 7 天，主观满意度（团队 5 人盲评）≥ 4/5
- [ ] 钉钉 SSO 全员可登录（已邀请测试 50 人验证）
- [ ] Antigravity Code Review 无 Critical 问题

---

> 本文档由 Claude Code 在 Plan Stage 产出，下一步动作（顺序经 Symphony DMA-6/DMA-18/DMA-19/DMA-20 四轮复评修正 · §13 决策已全 closed）：
> 用户评审 v0.6 → **生成 `spec/tasks.md`（按 task-template）** → 提交 Antigravity Plan Review（含 requirements + design + tasks + sub-agent 分工）→ Fix Plan（如有 Critical）→ Codex 实施。
