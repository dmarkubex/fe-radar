# FE-Radar — Design (v0.8 DRAFT)

> **v0.8 changelog (Antigravity 第二轮 Stage 4 Audit fix · 2 Systemic + 1 Edge)**：
> - **R1 (Account Merging Deadlock)** → 删除 §8 `users.mobile_hash` 字段 + 索引；§10c `mergeOrCreateUser()` 删除 step 2 mobileHash 分支；step 2 改为 "name+dept 唯一匹配本地账号 → 自动合并"，多匹配走 step 3 manual queue。与 requirements §10.2 "不拉手机号" 完全对齐
> - **R2 (Disable State 缺)** → §8 `users` 加 `disabled_at TIMESTAMPTZ`（NULL = active）；T-M5-03 用 disabled_at 实施软删/停用
> - **E1 (Detail API PII Leak)** → §9 API 表 `/api/items/:id` 行加默认排除 quota_state ∈ block / pending / dropped 注释（与 timeline 一致）；T-M3-05 同步

> **状态**：DRAFT · Antigravity DMA-23 评审 fix 已落地（v0.7）· 待复审
> **最后更新**：2026-05-08
> **作者**：Claude Code（Plan Stage 产出）
> **依赖**：本文档假定 `spec/requirements.md` v0.7 已读
>
> **v0.7 changelog (Antigravity DMA-23 Fix · 3 Critical + 3 Edge)**：
> - R1：§5 新增 scrubber 阶段（在 prefilter / scorer / daily-gen 调 LLM 前；packages/core/scrubber.ts 实现见 tasks.md T-M2-14/15）
> - R2：§10 新增 §10c 账号合并算法（mergeOrCreateUser + 冲突路由，与 requirements §10.4 对齐）
> - R3：§4 新增 §4.4 代理池 + UA 轮换（用于 T1 政府站；不绕 robots.txt；详见 tasks.md T-M1-10）
> - E1：§7 + tasks T-M2-09 加 ivfflat vs HNSW benchmark 前置约束
> - E2：§7.1 加 worker 装配层 Redis 分布式锁（防多 worker 并发建簇）
> - E3：§14 Dashboard backlog 行加 priority 陈旧度（>24h 占比）+ 阈值告警
> - §16 风险表对应行更新为 ✅ 闭合
>
> **v0.6 changelog (DMA-20 Symphony 复复复评 fix · 2 Major + 1 Minor)**：
> - F1：与 requirements.md §13/handoff.md 协同，§17 重写为"决策 → 设计模块映射追溯"（非阻塞）
> - F2：§9 API 表加 admin backlog drill-down endpoint 占位（M5 admin 后台 task 实施）
> - F3：§18 后续动作行同步到 v0.6
>
> **v0.5 changelog (DMA-19 Symphony 复复评 fix · 4 Major + 1 Minor)**：
> - F1：§8 `feedbacks.item_id` 加 `ON DELETE CASCADE`（修 cleanup 事务 FK 阻塞）
> - F2：§5.1 `admitToScoring()` 改为双独立 Redis 计数器 + Lua 原子脚本（`normal_used`≤1300 / `priority_used`≤200，仅成功 admit 时 incr）
> - F3：§5.1 backlog 加老化策略（7 天 → `dropped_quota_expired`）；§8 `quota_state` CHECK 加新值；§14 Dashboard 加 backlog 行
> - F4：§18 next steps 移除"解决 §13 开放问题"步骤（已 closed）
> - F5：§8 scoring_config seed 旁加 idempotent 说明
>
> **v0.4 changelog (DMA-18 Symphony 复评 fix · 6 Major + 2 Minor)**：
> - F1：§8 增加 `scoring_config` 默认 seed（INSERT 块，含 weights / thresholds / t_coef / c_coef）
> - F2：§11 `computeAlert()` 政策通道改判 NER `policy` 类型，与 §8 entity ontology 对齐
> - F3：§5.1 限速器改为优先级配额（1300 普通 + 200 保留）；新增 backlog `pending_over_quota` 状态机
> - F4：§8 `clusters.lead_item_id` 加 `ON DELETE SET NULL`；§14 cleanup job 加 `daily_reports` 90 天清理
> - F5：§8 `users` CHECK 收紧为完整凭据约束
> - F6：§18 后续动作更新到 v0.3/DMA-18 引用
> - F7：§9 API 表补 `/api/alerts?type=&level=&source=` + `/api/alerts/count`
> - F8：本 changelog 上一版（v0.3）"items 表删除原始 HTML 列"措辞替换字面 `raw_html`，避免 grep 误报
>
> **v0.3 changelog (Q-D…Q-K 决策内化)**：
> - Q-K：§5.1 锁定场景 A（日上限 1500），删除场景 B；§4.2 调度增加日配额限速器（v0.4 已升级为优先级配额）
> - Q-F + Q-J：新增 §10a 本地账号登录流程（M0–M3）；钉钉 §10 加 M4+ 阶段标注；§8 `users` 表加 `username` / `password_hash` 列
> - Q-H：§8 `item_analysis` 增加 `alert_type`（own / safety / policy）；§11 重写为多通道实现
> - Q-I：§8 schema 注释 90 天保留；新增定时清理 job
> - Q-D + Q-E：默认 `scoring_config` seed 写入 §8（v0.4 补齐 INSERT 块）
>
> **v0.2 changelog (Symphony DMA-6 评审 fix · 历史)**：
> - Finding 1：§18 后续动作顺序（tasks.md 在 Plan Review 之前）
> - Finding 2：§5.1 LLM 成本表参数化（已在 v0.3 锁定 A）
> - Finding 3：§1 架构图移除 MinIO 原文存储；§8 `items` 表删除原始 HTML 列
> - 复核补充：§12 stack.yml `TZ=Asia/Shanghai`；§16 风险增加 zhparser 检查项

---

## 0. 文档范围

本文档约束 **HOW**（怎么做）。**WHAT** 见 `spec/requirements.md`。

读者：Antigravity Plan Review、Codex 实施、未来运维。

---

## 1. 架构总览

```
                ┌─────────────────────────┐
                │   钉钉开放平台 OAuth     │
                └────────────┬────────────┘
                             │
┌────────────────────────────▼────────────────────────────┐
│            Web (Next.js 15 一体化 · App Router)          │
│  Pages: 时间线 / 精选 / 日报 / 告警 / 搜索 / 后台         │
│  API : Route Handlers (REST + SSE)                       │
└────────────┬────────────────────────────┬───────────────┘
             │                            │
             ▼                            ▼
┌──────────────────────┐      ┌──────────────────────────┐
│   Postgres 16        │      │   Redis 7                │
│   + pgvector 0.8     │◀────▶│   BullMQ queues + cache  │
└──────────▲───────────┘      └──────────┬───────────────┘
           │                             │
           │                             ▼
           │            ┌────────────────────────────────┐
           │            │  Worker (独立 Node 进程)         │
           │            │  ① fetcher    每 6h 抓 168+ 信源 │
           │            │  ② prefilter  Qwen 行业相关性    │
           │            │  ③ ner        Qwen 实体抽取     │
           │            │  ④ scorer     DeepSeek 5 维打分 │
           │            │  ⑤ embedder   Qwen 向量化       │
           │            │  ⑥ cluster    pgvector 聚簇     │
           │            │  ⑦ curator    代码计算最终分    │
           │            │  ⑧ daily-gen  Kimi 每天 08:00   │
           │            └──────┬─────────────┬───────────┘
           │                   │             │
           │                   ▼             ▼
           │      ┌────────────────┐  ┌──────────────┐
           │      │  Qwen3.6 27B   │  │ DeepSeek/Kimi │
           │      │  (本地内网)     │  │  (公网 API)    │
           │      └────────────────┘  └──────────────┘
           │
           ▼
┌──────────────────────┐
│   MinIO (S3 兼容)     │
│   PG 每日备份          │
│   日报静态导出（可选） │
│   ※ 不存第三方原文     │
└──────────────────────┘
```

---

## 2. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 前端框架 | **Next.js 15 (App Router) + React 19** | 一体化部署，SSR + RSC + Route Handlers 一站式 |
| UI | **Tailwind CSS + shadcn/ui** | 上手快，设计感强，时间线 / Tab / 卡片场景友好 |
| 状态 | **TanStack Query + URL state** | 无需 Redux；查询缓存 + 筛选状态写在 URL |
| ORM | **Drizzle ORM** | TypeScript 优先，SQL 透明，迁移可读，比 Prisma 轻 |
| 数据库 | **Postgres 16 + pgvector** | 全文检索 (zhparser) + 向量检索一站式 |
| 队列 | **BullMQ (Redis-based)** | Node 生态最稳，支持重试、延迟、并发控制 |
| 抓取 | **rss-parser + cheerio + playwright (按需)** | 三档：RSS 最优先，HTML 用 cheerio，SPA 用 playwright |
| 认证 | **Auth.js (NextAuth) + 钉钉 Provider** | 钉钉 OAuth 现成 provider，自定义少 |
| LLM SDK | **OpenAI SDK 兼容协议** | DeepSeek / Kimi / Qwen 全部支持 OpenAI 协议 |
| 容器 | **Docker Swarm via Portainer** | 用户既有 |
| 监控 | **Pino 结构化日志 + 自建 Dashboard 页** | 不引入 Prometheus 等额外服务，MVP 够用 |

---

## 3. 模块拆分

仓库为**单 repo**，目录结构：

```
/
├── apps/
│   └── web/                     # Next.js 一体化（前端 + API）
│       ├── app/                 # App Router
│       │   ├── (timeline)/      # 时间线、精选、告警
│       │   ├── (daily)/         # 日报
│       │   ├── (admin)/         # 后台
│       │   ├── api/             # Route Handlers
│       │   └── auth/            # 钉钉 SSO 回调
│       └── components/
│   └── worker/                  # 独立 Node 进程（BullMQ consumer）
│       ├── jobs/
│       │   ├── fetcher.ts
│       │   ├── prefilter.ts
│       │   ├── ner.ts
│       │   ├── scorer.ts
│       │   ├── embedder.ts
│       │   ├── cluster.ts
│       │   ├── curator.ts
│       │   └── daily-gen.ts
│       └── index.ts
│
├── packages/
│   ├── db/                      # Drizzle schema + migration + client
│   ├── llm/                     # Qwen / DeepSeek / Kimi 三家封装
│   ├── core/                    # 业务逻辑：评分公式、阈值判断、聚类规则
│   └── shared/                  # 类型 / 错误类 / 常量 / dayjs 配置
│
├── deploy/
│   ├── stack.yml                # docker swarm 编排清单
│   └── env.example
│
└── spec/                        # 本文档所在
```

**模块边界规则**（参考 `.ai/shared/style-invariants.md`）：
- 跨模块 import 必须经 `index.ts` 公共出口
- `apps/worker` 与 `apps/web` 共享 `packages/*`，不互相 import
- `packages/core` 不依赖 `packages/db`（业务规则纯函数化，便于单测）

---

## 4. 抓取层设计

### 4.1 三档 fetcher

| 类型 | 实现 | 适用 |
|---|---|---|
| `rss` | `rss-parser` | 大部分行业媒体 |
| `html` | `cheerio` + 自定义选择器 | 政府站、协会站列表页 |
| `playwright` | headless | SPA 站、JS 渲染列表 |

每个 `Source` 配置：
```ts
type SourceConfig =
  | { type: 'rss'; url: string }
  | { type: 'html'; listUrl: string; selectors: { item: string; title: string; link: string; date: string } }
  | { type: 'playwright'; listUrl: string; waitFor: string; extractor: string /* 函数序列化 */ }
```

### 4.2 调度

- 全局 cron：`0 */6 * * *`（00:00 / 06:00 / 12:00 / 18:00 上海时区）
- 每个 source 入队 `fetch-source` job，并发 5
- 单 source 失败重试 3 次（指数退避）
- 连续 7 天失败 → 自动禁用 + 告警

### 4.3 去重

- 按 `url` 唯一索引；命中则跳过
- 二次去重：标题 + 发布日期一致 → 视为重复（应对 url 带 utm 参数变化）

### 4.4 代理池 + UA 轮换（v0.7 R3）

政府类 T1 信源（国家能源局 / 发改委 / 工信部）历史上对持续抓取敏感，1s 间隔不一定能避免 429/403。引入代理池增强稳定性：

```
fetcher.fetch(url)
  ├─ acquire { proxy, userAgent } from packages/proxy-pool
  ├─ fetch via proxy
  ├─ on 429/403/timeout → release(failed) + acquire(retry=true)
  └─ on success → release(ok)
```

**配置**：
- 代理列表：docker secret `PROXY_LIST_FILE`（每行 `host:port[:user:pass]`，HTTP/HTTPS/SOCKS5）
- UA 池：默认 `FE-Radar Bot`（合规优先），仅 `sources.config.useRealUa=true` 的源（政府类）启用真实浏览器 UA 轮换
- Health check：每 5min 探测每个代理，连续失败 3 次自动 disable
- Feature flag：`PROXY_POOL_ENABLED` 可一键关（admin 后台），关闭时退回直连

**合规边界**（重点）：
- 代理池**仅用于绕过 IP 封禁**，不用于绕过 `robots.txt`
- 抓取前必须先解析 robots.txt（缓存 24h），命中 Disallow 路径**绝不抓取**
- 测试用例覆盖：robots.txt 中 `Disallow: /private` 路径在所有代理下都 skip

实施详见 `spec/tasks.md` T-M1-10。

---

## 5. 处理 Pipeline

每条 Item 入库后串行经过 8 个阶段，由 BullMQ 流水线驱动：

```
fetched → prefilter → ner → scorer ──▶ embedder → cluster → curator → done
                       │
                       └─▶ (如命中远东) alert
```

| 阶段 | 输入 | 输出 | LLM | 失败策略 |
|---|---|---|---|---|
| **prefilter** | title + 摘要 | `is_industry_related: bool` | Qwen3.6 27B 本地 | 失败标记 unknown，保留 item，不进入精选 |
| **ner** | full content | 7 类实体数组 | Qwen3.6 27B + 词典 | 词典优先；LLM 失败则仅词典结果 |
| **scorer** | full content + 实体 | D1, D3, D4, D5 (D2 由代码算) | DeepSeek V4 Pro | 失败重试 2 次后跳过本条 |
| **embedder** | title + 摘要 | vector(1024) | Qwen embedding | 失败重试 3 次 |
| **cluster** | embedding | cluster_id（新建或归入） | – | – |
| **curator** | 全部分数 | `quality_score`、`is_curated`、聚簇主条 | – | – |
| **daily-gen** | 24h 内 curated items | 5 版块日报 markdown | Kimi K2.6 (200K ctx) | 失败延后 30 分钟重试 |

### 5.1 LLM 分工原则

| LLM | 职责 | 部署 | 成本 |
|---|---|---|---|
| **Qwen3.6 27B**（本地内网） | 预筛、NER、Embedding | 内网 GPU | 0 边际成本（量大） |
| **DeepSeek V4 Pro** | 5 维评分（D1/D3/D4/D5）、摘要、翻译 | 公网 API | 廉价（约 ¥1/M token） |
| **Kimi K2.6** | 每日 1 次日报生成（200K context） | 公网 API | ≈ ¥0.5/天 |

预估月度 LLM 成本（**Q-K 决策 A 已锁定 · 1500 = 日上限**）：

| 项 | 月成本 |
|---|---|
| DeepSeek（D1/D3/D4/D5 评分 + 摘要 + 翻译）：1500 条/天 × 30 × 2.8K token × ¥1/M | 约 ¥120 |
| Kimi（每日日报 1 次 × 50K token）| 约 ¥30 |
| **合计** | **约 ¥150** |
| NFR-05 ≤500 元上限余量 | ✅ 350 元缓冲（应对峰值与重试）|

**调度限速器（NFR-01 配套 · 优先级配额 · v0.5 双计数器原子方案）**：

```
日预算 1500
├─ 1300 普通配额  (Redis key: scoring:counter:normal:YYYY-MM-DD)
└─  200 保留配额  (Redis key: scoring:counter:priority:YYYY-MM-DD)
```

**高优先级判定**（`packages/core/priority.ts`，纯函数，零 LLM 调用）：
1. 标题 / 内容词典快速命中"远东"系列实体 → `own` 候选
2. 标题 / 内容快速命中事故关键词（火灾 / 爆炸 / 停电 / 触电 / 死亡 等）→ `safety` 候选
3. 标题快速命中政策号格式（`GB/T \d+`、`〔20\d\d〕\d+号` 等正则）→ `policy` 候选

**入队逻辑（Lua 原子化避免竞态）**：

```ts
// packages/core/quota.ts
const ADMIT_LUA = `
  -- KEYS[1] = normal counter, KEYS[2] = priority counter
  -- ARGV[1] = isPriority(0/1), ARGV[2] = normalLimit, ARGV[3] = priorityLimit
  local isPriority = tonumber(ARGV[1])
  local normalLimit = tonumber(ARGV[2])
  local priorityLimit = tonumber(ARGV[3])

  local normalUsed = tonumber(redis.call('GET', KEYS[1]) or 0)
  local priorityUsed = tonumber(redis.call('GET', KEYS[2]) or 0)

  if isPriority == 1 then
    -- 高优先级先走 priority 配额，满了走 normal 余量
    if priorityUsed < priorityLimit then
      redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], 90000)
      return 'admit'
    end
    if normalUsed < normalLimit then
      redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 90000)
      return 'admit'
    end
    return 'pending'  -- 罕见：高优先级也超 1500/天
  else
    if normalUsed < normalLimit then
      redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 90000)
      return 'admit'
    end
    return 'pending'
  end
`

async function admitToScoring(item): Promise<'admitted' | 'pending_over_quota'> {
  const isPriority = detectPriority(item)
  const day = todayKey()
  const result = await redis.eval(
    ADMIT_LUA,
    [`scoring:counter:normal:${day}`, `scoring:counter:priority:${day}`],
    [isPriority ? 1 : 0, 1300, 200]
  )
  return result === 'admit' ? 'admitted' : 'pending_over_quota'
}
```

**关键性质**：
- 计数器**仅在成功 admit 时 incr**，backlog 不消耗预算
- Lua 脚本保证 GET + 比较 + INCR 原子性，避免并发超额
- Key TTL 90000s（25h），跨日自动重置；不需要 cron reset

**Backlog 处理 + 老化（v0.5 F3）**：

```ts
// packages/core/backlog.ts
async function drainBacklog() {
  // 1. 老化：>7 天未消化 → dropped_quota_expired
  await db.update(itemAnalysis)
    .set({ quota_state: 'dropped_quota_expired' })
    .where(and(
      eq(quota_state, 'pending_over_quota'),
      lt(fetched_at, now() - interval('7 days'))
    ))

  // 2. 消化：当天有余量时按优先级 → FIFO 取 backlog 重新入 admitToScoring
  for (const item of await loadPendingByPriority()) {
    if (await admitToScoring(item) === 'admitted') {
      await enqueueScorer(item)
    } else {
      break  // 当天预算耗尽
    }
  }
}
```

scheduler 每个 6h 窗口前调用 `drainBacklog()`，admin Dashboard 监控 `pending_over_quota` / `dropped_quota_expired` 行数，超阈值告警（见 §14）。

**`quota_state` 状态机**（`item_analysis` 字段，v0.5 扩展）：
- `admitted` ← 成功进入 LLM 链
- `pending_over_quota` ← 暂时超额，进 backlog
- `dropped_quota_expired` ← backlog 老化丢弃（终态，UI/API 默认排除）
- `dropped_filter` ← prefilter 判定非行业相关（保留为旧值）

---

### 5.x LLM Scrubber 阶段（v0.7 R1 · 公网 LLM 强制脱敏）

在 `prefilter / scorer / daily-gen` 三个调 LLM 的位置前**统一插入** scrubber 中间件（实施在 `packages/llm/client.ts` wrap 注入），保证敏感数据不外泄到公网 DeepSeek/Kimi。

```
fetcher → item → scrubber → { cleaned, level }
                              │
                  ┌───────────┴───────────┐
                  │                        │
              level=block             level=safe/redacted
                  │                        │
            跳过 LLM                   送 LLM (cleaned)
            quota_state=admitted        正常评分
            summary_zh='[需人工脱敏]'
            进 admin 待处理队列
```

**敏感类别**：手机号 / 身份证 / 邮箱 / 内网 IP（10. / 172.16-31. / 192.168.）/ MAC / admin 后台维护的"内部项目代号"词典。
**替换格式**：`[REDACTED:<TYPE>:<HASH8>]`，hash 用于 audit 不可逆。
**Audit log**：仅含 `item_id` + redactions 计数与类别，不含原文。
**性能**：1KB 文本 < 5ms（hot path 限制）。
**Fail-safe**：scrubber 抛异常 → 默认 block（保守）。
**PROD 强制启用**；DEV 环境通过 `SCRUBBER_ENABLED` 可关。

实施详见 `spec/tasks.md` T-M2-14（模块）+ T-M2-15（LLM 链集成）。

---

## 6. 评分实现

### 6.1 D1/D3/D4/D5 由 LLM 输出

DeepSeek 单次调用返回结构化 JSON：
```json
{
  "d1_policy": 75,
  "d3_market": 40,
  "d4_tech": 60,
  "d5_business": 55,
  "category": "技术与产品",
  "summary_zh": "...",
  "translation_zh": "..." // 仅当原文非中文
}
```
- 用 `response_format: json_schema` 强约束
- prompt 模板单独管理在 `packages/llm/prompts/scoring.ts`，**目标 ≤ 200 行**
- 模型不输出最终分，不出 `is_curated`

### 6.2 D2 由代码算（关键反 AI Slop）

```ts
// packages/core/scoring.ts
function computeD2Chain(entityIds: string[], entityCircleMap: Map<string, 'C1'|'C2'|'C3'>): number {
  const hits = entityIds.map(id => entityCircleMap.get(id)).filter(Boolean)
  if (hits.includes('C1')) return 95   // 自家公司被提及
  if (hits.filter(c => c === 'C2').length >= 2) return 80  // 多个竞品/上下游
  if (hits.includes('C2')) return 70
  if (hits.includes('C3')) return 50
  return 20  // 完全无关产业链
}
```

### 6.3 最终分

```ts
quality = (D1*w1 + D2*w2 + D3*w3 + D4*w4 + D5*w5) * T_coef * C_coef
```
权重、系数、阈值全部存 `scoring_config` 表，admin 可调，**调整无需发版**。

### 6.4 是否精选

```ts
const threshold = thresholds[category][topCircle]  // 例如 ['技术与产品']['C2'] = 65
isCurated = quality >= threshold
```

---

## 7. 事件聚类

### 7.1 算法

- 每条 Item 入库时计算 embedding（Qwen embedding，1024 维）
- pgvector ivfflat 索引检索 24h 内最相似条目
- 余弦相似度 ≥ 0.85 → 加入既有簇；否则新建簇

### 7.2 主条选举

簇内按以下优先级取主条：
1. 信源 T1 > T2 > T3
2. 同 T 内：发布最早者
3. 同发布时间：标题最长者（信息量更多）

### 7.3 展示

精选 Tab 只显示主条 + "+N 关联报道"。点开主条 → 弹层显示簇内全部 Item。

---

## 8. 数据模型（核心 schema）

完整 schema 见 `packages/db/schema.ts`，此处列关键表与索引。

```sql
-- 信源
CREATE TABLE sources (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  fetcher_type TEXT NOT NULL CHECK (fetcher_type IN ('rss','html','playwright')),
  config       JSONB NOT NULL,
  tier         TEXT NOT NULL CHECK (tier IN ('T1','T2','T3')),
  category     TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  last_ok_at   TIMESTAMPTZ,
  fail_count   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 实体词典
CREATE TABLE entities (
  id             BIGSERIAL PRIMARY KEY,
  type           TEXT NOT NULL,                            -- company/product/policy/region/project_type/...
  canonical_name TEXT NOT NULL,
  aliases        TEXT[] NOT NULL DEFAULT '{}',
  circle         TEXT CHECK (circle IN ('C1','C2','C3')),  -- 仅 company 类有
  weight         REAL NOT NULL DEFAULT 1.0,
  meta           JSONB,
  UNIQUE (type, canonical_name)
);
CREATE INDEX entities_aliases_gin ON entities USING gin (aliases);

-- 抓取的 Item（注意：按 FR-12 + requirements §12，不存原始 HTML 快照；content 是抽取后的纯文本）
CREATE TABLE items (
  id            BIGSERIAL PRIMARY KEY,
  source_id     BIGINT NOT NULL REFERENCES sources(id),
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  content       TEXT,                                     -- 抽取的纯文本，不含原始 HTML
  lang          TEXT,
  published_at  TIMESTAMPTZ NOT NULL,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX items_published_at_idx ON items (published_at DESC);
CREATE INDEX items_fts_idx ON items USING gin (
  to_tsvector('zhparser', coalesce(title,'') || ' ' || coalesce(content,''))
);

-- 处理结果
CREATE TABLE item_analysis (
  item_id              BIGINT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  is_industry_related  BOOLEAN,
  summary_zh           TEXT,
  translation_zh       TEXT,
  d1_policy            REAL,
  d2_chain             REAL,
  d3_market            REAL,
  d4_tech              REAL,
  d5_business          REAL,
  quality_score        REAL,
  category             TEXT,
  top_circle           TEXT,                                -- C1/C2/C3
  is_curated           BOOLEAN NOT NULL DEFAULT FALSE,
  alert_level          TEXT,                                -- L1/L2/L3/null（信源 tier 决定）
  alert_type           TEXT,                                -- own/safety/policy/null（Q-H 多通道）
  quota_state          TEXT CHECK (quota_state IN ('admitted','pending_over_quota','dropped_quota_expired','dropped_filter')) DEFAULT 'admitted',
  embedding            vector(1024),
  scored_at            TIMESTAMPTZ
);
CREATE INDEX analysis_quality_idx ON item_analysis (quality_score DESC) WHERE is_curated;
CREATE INDEX analysis_emb_idx ON item_analysis USING ivfflat (embedding vector_cosine_ops);

-- NER 命中
CREATE TABLE item_entities (
  item_id   BIGINT REFERENCES items(id) ON DELETE CASCADE,
  entity_id BIGINT REFERENCES entities(id),
  span      TEXT,
  PRIMARY KEY (item_id, entity_id)
);

-- 事件聚簇
CREATE TABLE clusters (
  id            BIGSERIAL PRIMARY KEY,
  centroid      vector(1024),
  lead_item_id  BIGINT REFERENCES items(id) ON DELETE SET NULL,  -- 90 天清理 items 时簇主条置空，cluster 本身保留至下次 stale 清理
  event_type    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE cluster_items (
  cluster_id BIGINT REFERENCES clusters(id) ON DELETE CASCADE,
  item_id    BIGINT REFERENCES items(id) ON DELETE CASCADE,
  similarity REAL,
  PRIMARY KEY (cluster_id, item_id)
);

-- 日报
CREATE TABLE daily_reports (
  date         DATE PRIMARY KEY,
  sections     JSONB NOT NULL,                             -- 5 版块结构化内容
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用户（M0-M3 本地账号；M4+ 与钉钉 SSO 并存；v0.7 加合并字段；v0.8 删 mobile_hash + 加 disabled_at）
CREATE TABLE users (
  id                    BIGSERIAL PRIMARY KEY,
  username              TEXT UNIQUE,                              -- M0-M3 本地登录用；钉钉用户可空
  password_hash         TEXT,                                     -- bcrypt(work_factor=12)；钉钉用户可空
  dingtalk_id           TEXT UNIQUE,                              -- unionid；M4+ 接入；本地账号可空
  name                  TEXT NOT NULL,
  dept                  TEXT,
  role                  TEXT NOT NULL DEFAULT 'viewer',           -- viewer/editor/admin
  merged_at             TIMESTAMPTZ,                              -- v0.7 R2：合并发生时间
  merged_from_user_id   BIGINT REFERENCES users(id),              -- v0.7 R2：被合并方 id（追溯）
  disabled_at           TIMESTAMPTZ,                              -- v0.8 R2：停用时间；NULL = active；登录中间件检查
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (username IS NOT NULL AND password_hash IS NOT NULL)    -- 完整本地凭据
    OR dingtalk_id IS NOT NULL                              -- 或钉钉账号
  )
);
CREATE INDEX users_active_idx ON users (id) WHERE disabled_at IS NULL;

-- 账号合并冲突表（v0.7 R2）：name+dept 匹配但需 admin 手动 confirm
CREATE TABLE merge_conflicts (
  id              BIGSERIAL PRIMARY KEY,
  unionid         TEXT NOT NULL,                            -- 待合并的钉钉 unionid
  name            TEXT NOT NULL,
  dept            TEXT,
  candidate_ids   BIGINT[] NOT NULL,                        -- 候选 users.id 数组
  status          TEXT NOT NULL DEFAULT 'pending',          -- pending / confirmed / rejected
  resolved_by     BIGINT REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX merge_conflicts_status_idx ON merge_conflicts (status, created_at DESC);

-- 反馈
CREATE TABLE feedbacks (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT REFERENCES items(id) ON DELETE CASCADE,  -- v0.5 F1：与 90 天 cleanup 联动
  user_id     BIGINT REFERENCES users(id),
  vote        SMALLINT CHECK (vote IN (-1, 0, 1)),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 评分配置（参数化）
CREATE TABLE scoring_config (
  key   TEXT PRIMARY KEY,                                  -- 'weights' / 'thresholds' / 't_coef' / 'c_coef'
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES users(id)
);

-- 默认 seed（Q-D + Q-E 决策；版本控制内 packages/db/migrations/<n>_scoring_config_seed.sql）
INSERT INTO scoring_config (key, value) VALUES
  ('weights',    '{"w1":0.20,"w2":0.25,"w3":0.20,"w4":0.15,"w5":0.20}'::jsonb),
  ('t_coef',     '{"T1":1.00,"T2":0.85,"T3":0.70}'::jsonb),
  ('c_coef',     '{"C1":1.20,"C2":1.00,"C3":0.85}'::jsonb),
  ('thresholds', '{
      "政策与标准":   {"C1":55,"C2":60,"C3":65},
      "市场与价格":   {"C1":55,"C2":60,"C3":70},
      "技术与产品":   {"C1":55,"C2":65,"C3":75},
      "项目与招投标": {"C1":50,"C2":60,"C3":70},
      "公司与资本":   {"C1":55,"C2":65,"C3":75}
   }'::jsonb)
ON CONFLICT (key) DO NOTHING;
```

> **Seed 文件分工**：
> - `packages/db/migrations/<n>_scoring_config_seed.sql` —— 入版本控制（产品默认配置）
> - `packages/db/migrations/seed.local.sql` —— gitignore（首批 admin 用户名+临时密码 hash，含敏感信息）
>
> **Idempotent 性质（v0.5 F5）**：seed 块用 `ON CONFLICT (key) DO NOTHING`，**重跑 migration 不会覆盖** admin 后台改过的 `scoring_config` 行（因为 key 已存在）。这是有意设计 —— admin 在产线调权重/阈值后不会被新部署还原。如果未来需要"强制升级默认值"，应单写一个 admin 触发的一次性 SQL，而不是改 seed 行为。

---

## 9. API 端点（关键）

| Method | Path | 说明 | 权限 |
|---|---|---|---|
| GET  | `/api/timeline?cursor=&filter=` | 时间线分页 | viewer+ |
| GET  | `/api/curated?category=&circle=` | 精选 | viewer+ |
| GET  | `/api/daily?date=` | 日报 | viewer+ |
| GET  | `/api/alerts?type=&level=&source=&cursor=` | 告警列表（type ∈ own/safety/policy；level ∈ L1/L2/L3）| viewer+ |
| GET  | `/api/alerts/count` | 当日 own/safety/policy 三类计数（顶栏 Badge 用，60s 轮询）| viewer+ |
| GET  | `/api/admin/backlog?state=pending_over_quota\|dropped_quota_expired&cursor=` | admin 抽查配额 backlog 与过期丢弃条目（v0.6 F3 占位 · 实施在 M5 admin 后台 task）| admin |
| GET  | `/api/search?q=&filter=` | 搜索 | viewer+ |
| GET  | `/api/items/:id` | 详情（含聚簇内全部条目）· **默认拒绝 quota_state ∈ pending/dropped/block-summary 的 item（403/404）；admin 通过 ?includeBlocked=true 才能看（v0.8 E1 fix）** | viewer+ |
| POST | `/api/items/:id/feedback` | 反馈 | viewer+ |
| GET  | `/api/sources` / POST/PUT/DELETE | 信源管理 | editor+ |
| GET  | `/api/entities` / POST/PUT/DELETE | 实体词典 | editor+ |
| GET  | `/api/scoring-config` / PUT | 评分参数 | admin |
| GET  | `/api/dashboard` | 系统监控 | admin |

约定：
- 所有 JSON 请求/响应字段为 `camelCase`
- 错误结构 `{ error: { code, message, details? } }`
- 分页统一 `cursor` 模式

---

## 10. 认证流程

### 10a. 本地账号登录（M0–M3）

```
[用户] ── username + password ──▶ POST /api/auth/login
                                          │
                                          ▼
                          users 表查 username + bcrypt.compare(password, password_hash)
                                          │
                                          ▼
                          颁发 NextAuth JWT (httpOnly cookie · 2h + 滑动续期)
                                          │
                                          ▼
                                    跳转 / 主页
```

**首批 admin 预置**：`packages/db/migrations/seed.sql` 在 INSERT 中插入 admin 账号（密码先用临时值，首次登录强制改密）。具体账号清单由人工维护，不入版本控制（用 `seed.local.sql`，gitignore）。

### 10b. 钉钉 SSO 流程（M4+）

```
[用户] ──扫码──▶ [钉钉] ──回调 code──▶ /api/auth/callback/dingtalk
                                              │
                                              ▼
                          换 access_token & 拉用户基本信息（仅 name + dept）
                                              │
                                              ▼
                          users 表 upsert (dingtalk_id 唯一)
                                              │
                                              ▼
                          颁发 NextAuth JWT (httpOnly cookie)
                                              │
                                              ▼
                                    跳转 / 主页
```

新用户默认 `role = 'viewer'`，admin 后台手动升级。本地账号与钉钉账号可同存（同一用户绑定两条登录链路）。**首次钉钉登录走 §10c 合并策略**，不直接 INSERT。

### 10c. 账号合并策略（v0.7 R2 · `mergeOrCreateUser`）

钉钉首次登录的合并决策树（实施 `apps/web/lib/auth/merge.ts` · v0.8 删除 mobile_hash 路径）：

```ts
async function mergeOrCreateUser({ unionid, name, dept }) {
  // 注：钉钉 OAuth 不返回手机号（requirements §10.2 "不拉手机号"），故不依赖 mobile_hash
  return await db.transaction(async tx => {
    // 1. 已绑定 → 直接登录
    const byUnionid = await tx.query.users.findFirst({ where: eq(users.dingtalk_id, unionid) })
    if (byUnionid) return byUnionid

    // 2. name + dept 完全匹配（且 dingtalk_id 为空）的本地账号
    const candidates = await tx.query.users.findMany({
      where: and(eq(users.name, name), eq(users.dept, dept), isNull(users.dingtalk_id))
    })

    if (candidates.length === 1) {
      // 2a. 唯一匹配 → 自动合并
      const target = candidates[0]
      await tx.update(users).set({
        dingtalk_id: unionid,
        merged_at: new Date(),
      }).where(eq(users.id, target.id))
      await audit('auto-merge', target.id, unionid)
      return target
    }

    if (candidates.length >= 2) {
      // 2b. 多个候选 → 写冲突表，admin 手动 confirm；同时新建 dingtalk-only 避免登录卡死
      await tx.insert(mergeConflicts).values({
        unionid, name, dept,
        candidate_ids: candidates.map(c => c.id),
        status: 'pending'
      })
      await audit('merge-conflict-pending', null, unionid)
    }

    // 3. 兜底（无候选 / 多候选）：新建 dingtalk-only 账号
    const [created] = await tx.insert(users).values({
      dingtalk_id: unionid, name, dept,
      role: 'viewer'
    }).returning()
    return created
  })
}
```

**关键设计点（v0.8）**：
- **不再依赖 mobile_hash**：钉钉 OAuth 不返回手机号，原 v0.7 的 mobile_hash 自动合并路径**理论上永不命中** → 删除避免误导实施
- **唯一 name+dept 自动合并**：同一 dept 内重名概率低（500 人企业），唯一匹配即合并；这是大概率分支，避免 admin 手动确认 500 次
- **多候选走 manual**：保留 admin confirm 兜底，覆盖同 dept 重名的少数情况

**Schema 新增**（v0.7/v0.8 · 已落到 §8 SQL 块）：
- `users.merged_at` / `users.merged_from_user_id`（v0.7 R2）
- `users.disabled_at`（v0.8 R2 · 软删/停用）
- `merge_conflicts` 表（含 status 索引）
- ❌ `users.mobile_hash` **已删**（v0.8 R1）

**保留字段规则**：role 取 max（viewer < editor < admin，避免降权），created_at 取 min，feedbacks / audit log 全保留。
**并发安全**：事务 + UNIQUE(dingtalk_id) 双保险。
**admin 操作**：`/admin/users/merge-conflicts` 页支持 confirm / reject 待合并条目（实施 T-M5-03）。

实施详见 `spec/tasks.md` T-M4-05a。

---

## 11. 告警实现（Q-H 多通道 alert_type）

### 11.1 触发链路

`curator` 阶段对每条 scored item 计算 `alert_type` + `alert_level`：

```ts
// packages/core/alert.ts
async function computeAlert(item, source, scores, entities): Promise<{ alert_type?: 'own'|'safety'|'policy', alert_level?: 'L1'|'L2'|'L3' }> {
  const ownEntityIds = await getOwnCompanyEntityIds()  // 缓存 5 分钟
  const tierLevel = (t: 'T1'|'T2'|'T3') => t === 'T1' ? 'L1' : t === 'T2' ? 'L2' : 'L3'

  // 1. 自家公司（Q-H 'own' 通道，优先级最高）
  if (entities.some(e => ownEntityIds.has(e.id))) {
    return { alert_type: 'own', alert_level: tierLevel(source.tier) }
  }

  // 2. 安全事故
  if (entities.some(e => e.type === 'event_type' && e.canonicalName === '事故') && scores.d5_business >= 70) {
    return { alert_type: 'safety', alert_level: tierLevel(source.tier) }
  }

  // 3. 政策突发（NER 'policy' 类型实体命中，如标准号 / 政策文号；与 §8 entity ontology 一致）
  if (entities.some(e => e.type === 'policy') && scores.d1_policy >= 75) {
    return { alert_type: 'policy', alert_level: tierLevel(source.tier) }
  }

  return {}
}
```

### 11.2 站内表现

- 全局 layout 顶部右上角 Badge：今日 own + safety + policy 三类告警**分别**计数（每 60s 轮询 `/api/alerts/count`，返回 `{ own, safety, policy }`）
- 时间线 / 精选页对 `alert_type` 非空条目加色条：own 红/橙/黄、safety 灰、policy 蓝
- `/alerts` 页支持双层筛选：`type` (own/safety/policy/all) × `level` (L1/L2/L3/all) × 信源 × 时间

---

## 12. 部署拓扑（Docker Swarm Stack）

文件：`deploy/stack.yml`，关键服务：

```yaml
version: '3.9'
services:
  web:
    image: fe-radar/web:${TAG}
    deploy: { replicas: 2, restart_policy: { condition: any } }
    environment:
      TZ: Asia/Shanghai                                    # ⬅ 保证 cron / 日报时间准
      DATABASE_URL: postgres://fe:***@postgres:5432/feradar
      REDIS_URL: redis://redis:6379
      DINGTALK_APP_KEY: ${DINGTALK_APP_KEY}
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      KIMI_API_KEY: ${KIMI_API_KEY}
      QWEN_BASE_URL: http://qwen-internal.example.com/v1
    networks: [internal]
    ports: ["3000:3000"]

  worker:
    image: fe-radar/worker:${TAG}
    deploy: { replicas: 3 }
    environment:
      TZ: Asia/Shanghai
    command: ["node", "dist/worker/index.js"]
    networks: [internal]

  scheduler:
    image: fe-radar/worker:${TAG}
    deploy: { replicas: 1 }
    environment:
      TZ: Asia/Shanghai
    command: ["node", "dist/worker/scheduler.js"]
    networks: [internal]

  postgres:
    image: pgvector/pgvector:pg16
    deploy: { replicas: 1, placement: { constraints: [node.role==manager] } }
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [internal]

  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]
    networks: [internal]

  minio:
    image: minio/minio
    command: server /data
    volumes: [miniodata:/data]
    networks: [internal]

volumes: { pgdata: {}, redisdata: {}, miniodata: {} }
networks: { internal: { driver: overlay, attachable: true } }
```

资源请求初估：
| 服务 | 内存 | CPU |
|---|---|---|
| web × 2 | 512 MB ea | 0.5 ea |
| worker × 3 | 768 MB ea | 0.5 ea |
| scheduler | 256 MB | 0.1 |
| postgres | 4 GB | 1.0 |
| redis | 256 MB | 0.2 |
| minio | 512 MB | 0.2 |
| **合计** | **≈ 8 GB** | **≈ 4 核** |

---

## 13. 安全与权限

| 项 | 措施 |
|---|---|
| 网络 | 仅内网；VPN 进入；不暴露公网 |
| 认证 | 钉钉 SSO；JWT 仅 httpOnly cookie；2h 过期 + 滑动续期 |
| 授权 | 三角色 RBAC（viewer/editor/admin）；后台路由中间件统一拦截 |
| 输入 | 所有 API 请求经 Zod schema 校验 |
| 注入 | Drizzle 参数化查询；禁止字符串拼 SQL |
| 日志 | 不记录用户敏感信息（手机号、token） |
| 抓取合规 | 遵守 robots.txt；UA 标识 "FE-Radar Bot"；同站间隔 ≥ 1s |
| 数据最小化 | 不存原始 HTML 快照；不拉/不存用户手机号（与 requirements §12 对齐） |
| 备份 | Postgres 每日 02:00 全备 → MinIO，保留 30 天；MinIO 数据卷外挂 NAS（运维侧）|

---

## 14. 监控与运维

**MVP 不引入 Prometheus**，自建一个 admin Dashboard 页（`/admin/dashboard`）：

- 信源健康表（最近 24h 抓取成功率 / 失败次数）
- LLM 调用量与失败率（24h、7d）
- 处理 pipeline 各阶段队列堆积、延迟
- 聚类质量（每日新建簇数、簇平均大小）
- 用户反馈分布（+1 / -1 / 备注 top 词）
- 自家告警最近 24h 计数
- **Backlog 健康（v0.5 F3）**：`pending_over_quota` 当前总数、最老条目 fetched_at 距今天数、当日 `dropped_quota_expired` 新增数；阈值告警：`pending_over_quota` 总数 > 1000 或最老条目 > 5 天 → 红色提示

数据来源：直接查 PG + Redis（BullMQ API），无需新组件。

**90 天保留 cleanup job**（Q-I 决策 · v0.4 F4 修复 cluster + daily_reports 漏项）：

scheduler 每天 03:00 执行下面四步（事务）：

```sql
BEGIN;
-- 1. 删过期 items：item_analysis / item_entities / cluster_items 通过 ON DELETE CASCADE 联动；
--    clusters.lead_item_id 通过 ON DELETE SET NULL 联动（避免 FK 阻塞删除）
DELETE FROM items WHERE fetched_at < now() - interval '90 days';

-- 2. 清陈旧 cluster：lead_item_id 为 NULL 且 24h 内无新 cluster_items 关联
DELETE FROM clusters
 WHERE lead_item_id IS NULL
   AND id NOT IN (SELECT cluster_id FROM cluster_items WHERE cluster_items.cluster_id = clusters.id);

-- 3. 清过期日报（生成内容也含第三方摘要，纳入 90 天保留）
DELETE FROM daily_reports WHERE date < (current_date - interval '90 days');

-- 4. 清过期反馈
DELETE FROM feedbacks WHERE created_at < now() - interval '90 days';
COMMIT;
```

**永久保留**（不在清理范围）：`sources` / `entities` / `scoring_config` / `users`。这些是配置型数据，删了系统跑不起来。

---

## 15. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| 单元 | Vitest | `packages/core/scoring.ts` 必须 100% 覆盖 |
| 集成 | Vitest + Testcontainers (PG + Redis) | fetcher、worker pipeline 端到端 |
| E2E | Playwright | 时间线、精选、登录、告警关键路径 |
| 回测 | 自研 script | 评分公式参数变更前用历史 500 条跑 A/B |

---

## 16. 关键风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 钉钉应用回调域名管理员未提供 | 阻塞 SSO | ✅ 已落实（Q-F 决策）：M0–M3 本地账号登录，M4+ 接入钉钉 |
| 政府站反爬 / IP 封禁 | 抓取失败 | ✅ v0.7 R3 闭合：§4.4 代理池 + UA 轮换 + 失败切代理（不绕 robots.txt）|
| 公网 LLM 数据泄密 | 内网敏感信息外泄到 DeepSeek/Kimi | ✅ v0.7 R1 闭合：§5.x scrubber 强制中间件 + block 类跳过 + audit log |
| 钉钉登录账号碎片化 | RBAC 角色丢失 / 多重账号 | ✅ v0.7 R2 闭合：§10c mergeOrCreateUser 合并策略 + 冲突 admin 手动 confirm |
| 向量索引选型 | ivfflat 在 500K+ 数据上精度下降 | ✅ v0.7 E1：M2 实施前 ivfflat vs HNSW benchmark（tasks T-M2-09）|
| 多 worker 并发建簇 | 相似 item 创建多个簇 | ✅ v0.7 E2：worker 装配层 Redis 分布式锁（tasks T-M2-10）|
| priority backlog 饥饿 | 陈旧高分条目占 200/天 配额 | ✅ v0.7 E3：陈旧度监控 + Dashboard 告警（>24h 占比 >30% 红色）|
| 本地 Qwen GPU 资源不足 | 处理延迟 | 队列限速；预筛失败 fallback DeepSeek |
| LLM 输出不符 JSON schema | 评分失败 | 用 `json_schema` 强约束 + 二次重试 + 兜底默认值 |
| 评分公式漂移 | 精选质量下降 | 参数化 + 自动回测（覆盖 500 历史条） |
| 中文分词不准（zhparser 装配） | 全文搜索差 | M0 任务中显式验证：`pgvector/pgvector:pg16` 镜像默认**不带** zhparser，需自定义 Dockerfile 安装；或 fallback 到 `pg_trgm` + ILIKE |
| 容器时区 UTC 导致 cron / 日报时间错 | 日报触发时间漂移 | stack.yml 全量 service 注入 `TZ=Asia/Shanghai`（已在 §12 体现）|
| 法务对抓取版权疑虑 | 合规 | 仅站内展示标题 + 自生成摘要，不存第三方全文 HTML 永久版本 |

---

## 17. §13 决策 → 设计模块映射（历史追溯）

> 本节记录 §13 已 closed 决策与本文档对应模块的映射。**全部决策已 closed**，本节不再阻塞下游流程，仅供后续维护与回归测试时定位影响面。

| 决策（Q）| 决策内容 | 影响的设计模块 |
|---|---|---|
| Q-B 名单 | 暂保持现状 | §8 entities 表 + admin 后台 CRUD |
| Q-C 信源 | 用户全采用候选 v1（37 条）| §4 fetcher · §8 sources 表 seed |
| Q-D 权重 | 接受默认 | §6 + §8 scoring_config seed |
| Q-E 阈值 | 接受默认 | §6 + §8 scoring_config seed |
| Q-F 钉钉 | M0–M3 本地账号 / M4+ 钉钉 | §8 users 表 + §10a/§10b |
| Q-G 软文 | A 不做 | §6 评分维度保持 5 维（无 D6）|
| Q-H 安全事故 | C 多通道 alert_type | §8 item_analysis.alert_type + §11 |
| Q-I 保留期 | 全部 90 天 | §8 schema + §14 cleanup job |
| Q-J admin | SQL seed 预置 | §10a + seed.local.sql |
| Q-K 1500 | A 日上限 + 优先级配额 | §5.1 admitToScoring + drainBacklog |

---

## 18. 后续动作

> 顺序经 Symphony DMA-6 → DMA-18 → DMA-19 → DMA-20 → DMA-21 共四轮 fix + 一轮 pass 复评修正：tasks.md 必须在 Antigravity Plan Review **之前**产出（`.ai/shared/review-protocol.md §1.Gate1`）。所有 §13 决策 v0.6 已 closed，从顺序中移除。

| # | 动作 | 负责 |
|---|---|---|
| 1 | Human Review requirements.md v0.6 + design.md v0.6（含 DMA-6/DMA-18/DMA-19/DMA-20 fix）| **用户** |
| 2 | DMA-21 Codex 第四轮复评 v0.6（最终关卡）| Codex / Symphony |
| 3 | 客户化 `.ai/shared/style-invariants.md`（Next.js + TS 约束）| Claude Code |
| 4 | 产出 `spec/tasks.md`（按 task-template 格式 · 按 M0–M5 拆 sub-agent 分工）| Claude Code |
| 5 | 运行 `/init` 更新 CLAUDE.md 项目部分 | Claude Code |
| 6 | Antigravity Plan Review（含 requirements + design + tasks + 分工策略）| Antigravity |
| 7 | Fix Plan（仅当 Critical 存在）| Claude Code |
| 8 | Codex 实施 M0–M5 | Codex |

---

> 本文档由 Claude Code 在 Plan Stage 产出，未冻结。
