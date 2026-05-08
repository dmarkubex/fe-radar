# FE-Radar — Design (v0.1 DRAFT)

> **状态**：DRAFT · 待 Human 评审 · **未冻结**
> **最后更新**：2026-05-08
> **作者**：Claude Code（Plan Stage 产出）
> **依赖**：本文档假定 `spec/requirements.md` v0.1 已读

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
│   原文 HTML / 截图    │
│   PG 备份             │
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

预估月度 LLM 成本（NFR-05 ≤500 元）：
- DeepSeek：1500 条/天 × 30 × 评分提示≈2K token + 摘要≈800 token → 约 ¥120/月
- Kimi：30 次日报 × 50K token → 约 ¥30/月
- 留 350 元缓冲应对峰值与重试

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

-- 抓取的 Item
CREATE TABLE items (
  id            BIGSERIAL PRIMARY KEY,
  source_id     BIGINT NOT NULL REFERENCES sources(id),
  url           TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  content       TEXT,
  raw_html      TEXT,
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
  alert_level          TEXT,                                -- L1/L2/L3/null
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
  lead_item_id  BIGINT REFERENCES items(id),
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

-- 用户
CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  dingtalk_id  TEXT NOT NULL UNIQUE,                       -- unionid
  name         TEXT NOT NULL,
  dept         TEXT,
  role         TEXT NOT NULL DEFAULT 'viewer',             -- viewer/editor/admin
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 反馈
CREATE TABLE feedbacks (
  id          BIGSERIAL PRIMARY KEY,
  item_id     BIGINT REFERENCES items(id),
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
```

---

## 9. API 端点（关键）

| Method | Path | 说明 | 权限 |
|---|---|---|---|
| GET  | `/api/timeline?cursor=&filter=` | 时间线分页 | viewer+ |
| GET  | `/api/curated?category=&circle=` | 精选 | viewer+ |
| GET  | `/api/daily?date=` | 日报 | viewer+ |
| GET  | `/api/alerts?level=` | 告警 | viewer+ |
| GET  | `/api/search?q=&filter=` | 搜索 | viewer+ |
| GET  | `/api/items/:id` | 详情（含聚簇内全部条目） | viewer+ |
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

## 10. 钉钉 SSO 流程

```
[用户] ──扫码──▶ [钉钉] ──回调 code──▶ /api/auth/callback/dingtalk
                                              │
                                              ▼
                          换 access_token & 拉用户基本信息
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

新用户默认 `role = 'viewer'`，admin 后台手动升级。

---

## 11. 自家公司告警实现

### 11.1 触发链路

`scorer` 完成后，`curator` 阶段：
```ts
const ownEntityIds = await getOwnCompanyEntityIds()  // 缓存 5 分钟
const hitsOwn = item.entityIds.some(id => ownEntityIds.has(id))
if (hitsOwn) {
  const tier = source.tier
  const level = tier === 'T1' ? 'L1' : tier === 'T2' ? 'L2' : 'L3'
  await db.update(itemAnalysis).set({ alertLevel: level }).where(...)
}
```

### 11.2 站内表现

- 全局 layout 顶部右上角 Badge：今日 L1+L2+L3 告警计数（每 60s 轮询 `/api/alerts/count`）
- 时间线 / 精选页对 alert_level 非空的条目加色条 + 优先排序
- `/alerts` 页倒序时间线，提供 level / 信源 / 时间筛选

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
    command: ["node", "dist/worker/index.js"]
    networks: [internal]

  scheduler:
    image: fe-radar/worker:${TAG}
    deploy: { replicas: 1 }
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
| 抓取合规 | 遵守 robots.txt；UA 标识 "FE-Radar Bot"；间隔 ≥ 1s |
| 备份 | Postgres 每日 02:00 全备 → MinIO，保留 30 天 |

---

## 14. 监控与运维

**MVP 不引入 Prometheus**，自建一个 admin Dashboard 页（`/admin/dashboard`）：

- 信源健康表（最近 24h 抓取成功率 / 失败次数）
- LLM 调用量与失败率（24h、7d）
- 处理 pipeline 各阶段队列堆积、延迟
- 聚类质量（每日新建簇数、簇平均大小）
- 用户反馈分布（+1 / -1 / 备注 top 词）
- 自家告警最近 24h 计数

数据来源：直接查 PG + Redis（BullMQ API），无需新组件。

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
| 钉钉应用回调域名管理员未提供 | 阻塞 SSO | 优先做"密码登录"占位，SSO 接通后切换 |
| 政府站反爬 / IP 封禁 | 抓取失败 | 三档 fetcher 降级；UA 合规；间隔 ≥1s |
| 本地 Qwen GPU 资源不足 | 处理延迟 | 队列限速；预筛失败 fallback DeepSeek |
| LLM 输出不符 JSON schema | 评分失败 | 用 `json_schema` 强约束 + 二次重试 + 兜底默认值 |
| 评分公式漂移 | 精选质量下降 | 参数化 + 自动回测（覆盖 500 历史条） |
| 中文分词不准（zhparser 装配） | 全文搜索差 | postgres 镜像里装好；或 fallback 到 ILIKE |
| 法务对抓取版权疑虑 | 合规 | 仅站内展示标题 + 自生成摘要，不存第三方全文 HTML 永久版本 |

---

## 17. 与 `requirements.md §13 开放问题` 的依赖关系

| Open Q | 阻塞设计哪部分 |
|---|---|
| Q-B / Q-C 名单与信源 | §5 处理 pipeline 数据进不来 |
| Q-D / Q-E 权重与阈值 | §6 评分公式默认值不生效 |
| Q-F 钉钉应用 | §10 SSO 接入 |
| Q-G 软文识别 | §6 是否新增 D6 维度 |
| Q-H 安全事故告警 | §11 是否新增独立通道 |

> 上述 5 个问题不解决，Codex 实施会因数据缺失而被阻塞。

---

## 18. 后续动作

| # | 动作 | 负责 |
|---|---|---|
| 1 | Human Review 本文档 + requirements.md | **用户** |
| 2 | 解决 §13 开放问题 | 用户 + Claude Code |
| 3 | Antigravity Plan Review | Antigravity |
| 4 | 修改后产出 `spec/tasks.md`（按 task-template 格式） | Claude Code |
| 5 | 客户化 `.ai/shared/style-invariants.md`（Next.js + TS 约束） | Claude Code |
| 6 | 运行 `/init` 更新 CLAUDE.md 项目部分 | Claude Code |
| 7 | Codex 实施 M0–M5 | Codex |

---

> 本文档由 Claude Code 在 Plan Stage 产出，未冻结。
