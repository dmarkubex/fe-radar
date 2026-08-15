# FE-Radar · 远东控股产业情报雷达

> 从噪音，到信号。让每一个决定，都有依据。
> From Noise to Signal.

FE-Radar 是面向 **电力 / 电线电缆 / 储能 / 能源** 行业的产业情报雷达。它每 6 小时自动抓取行业动态，经过滤、评分、聚类、告警后，以「时间线 + 精选 + 日报」三种视图，把混乱的信息整理成可行动的情报。

> 本项目原为远东控股内部使用的情报系统，现开源。仓库仅包含产品代码与安全加固，**不含任何真实凭据**（密钥全部走环境变量 / Docker Secret）。

---

## 它解决什么问题

- **信息碎片化**：行业每天产生成千上万条消息（政策、招标、扩产、检修、涨价、中标、事故、停产、并购、限电……），人工盯盘成本高、易漏报。
- **信源质量参差不齐**：同样一条消息，出处不同、可信度天差地别。
- **情报需要被加工**：原始抓取不等于情报——它需要被评分、聚类、关联到关注主体，并在关键事件上及时告警。

FE-Radar 的价值，是把"看过即忘"的流水，变成"可回溯、可筛选、可告警"的信号。

---

## 两条产品哲学

1. **信源比信息重要** —— 先精选最值得信任的源头，再处理信息。信源分 **T1 / T2 / T3** 三级（权威源 / 行业源 / 补充源），关注对象分 **C1 / C2 / C3** 三个关注圈。
2. **能用脚本就别用 Agent** —— LLM 只做它擅长的语言任务（摘要、翻译、评分、NER）；规则、阈值、聚类、配额、告警等确定性逻辑一律用代码控制，保证可复现、可审计、可回测。

---

## 核心能力

| 能力                      | 说明                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| **时间线 Timeline**       | 按时间聚合的情报流，支持信源分级 / 关注圈筛选                      |
| **每日精选 Briefing**     | 经评分与筛选的高质量条目聚合                                       |
| **智能日报 Daily Report** | 由 Kimi 长上下文模型生成，替你"读完一切"                           |
| **大宗商品行情简报**      | 每个工作日 16:00 推送铜 / 锂等商品行情（v1.1 商品简报）            |
| **告警 Alerts**           | 统一触发入口 `packages/core/alert.ts:computeAlert()`，规则驱动     |
| **五维评分**              | D2_chain（关注圈命中）必须由**代码计算**，保证对自家公司**零漏报** |
| **实体识别 NER**          | 7 类实体抽取（公司 / 产品 / 项目 / 地区 / 政策 / 事件 / 指标）     |
| **信源分级 & 关注圈**     | 可配置的信源与关注对象管理（配置存数据库，不硬编码）               |

---

## 技术栈

| 层         | 选型                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 前端 / API | Next.js 15 App Router · React 19 · TypeScript · Tailwind · shadcn/ui · TanStack Query                                                          |
| 数据库     | PostgreSQL 16 · pgvector（向量） · zhparser（中文分词） · Drizzle ORM                                                                          |
| 队列       | BullMQ · Redis 7                                                                                                                               |
| LLM        | 本地 **Qwen3.6 27B**（预筛 / NER / embedding） · **DeepSeek V4 Pro**（五维评分 / 摘要 / 翻译 / 商品简报） · **Kimi K2.6**（日报，200K 上下文） |
| 认证       | Auth.js（M0–M3 本地账号 bcrypt 12；M4+ 钉钉 SSO 并存，`mergeOrCreateUser` 合并）                                                               |
| 部署       | Docker Swarm via Portainer · 内网 · `TZ=Asia/Shanghai` · MinIO 备份                                                                            |

---

## 架构（Monorepo）

```
apps/
  web/       Next.js 一体化（前端 + API）
  worker/    BullMQ consumer（fetcher / pipeline / scheduler / cleanup）
packages/
  db/        Drizzle schema / migration / seed / repos
  llm/       Qwen / DeepSeek / Kimi 客户端 + scrubber 脱敏中间件
  core/      业务规则纯函数（scoring / quota / cluster / alert / scrubber / priority）
  shared/    AppError 子类 / 类型 / dayjs / 常量
deploy/      stack.yml / Dockerfile / secrets
scripts/     评分回测 / 信源验证
```

**模块边界**（违例 = 架构漂移）：`apps/web` 与 `apps/worker` 互不 import；跨 package 一律经 `index.ts` 公共出口；`packages/core` 不依赖 `packages/db`（业务规则纯函数化，便于单测）；无循环依赖（CI `madge --circular` 校验）。

**8 阶段 Pipeline**：抓取 → 过滤 → 五维评分 → 聚类 → 告警 → 精选 → 日报 → 清理。公网 LLM 调用前必经 `packages/core/scrubber.ts` 脱敏 + 审计日志（命中 PII 阈值则跳过 LLM）。

---

## 快速开始

> 前置：Node 22+ · pnpm 11 · Docker（PostgreSQL 16 + Redis 7，或 Docker Swarm）。

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # 按需填写环境变量（见下）
./dev.sh                                        # 起基础设施 + 迁移 + 种子 + 起开发服务
```

必需的运行时配置（全部为环境变量 / Docker Secret，**不入库**）：

- `DATABASE_URL` / `REDIS_URL` —— 数据库连接
- `QWEN_BASE_URL` / `QWEN_MODEL` / `QWEN_EMBEDDING_*` —— 本地 Qwen 端点（预筛 / NER / embedding）
- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` —— DeepSeek（评分 / 摘要 / 翻译）
- `KIMI_API_KEY` / `KIMI_BASE_URL` —— Kimi（日报）
- `NEXTAUTH_SECRET` / `AUTH_SECRET` —— 会话密钥
- `DINGTALK_APP_KEY` / `DINGTALK_APP_SECRET`（可选）—— 钉钉 SSO
- `GRAFANA_DINGTALK_WEBHOOK_URL`（可选）—— 告警推送

详细部署与信源配置见 `deploy/`、`docs/runbook/`。

---

## 安全说明

- **凭据零硬编码**：所有密钥走环境变量或 Docker Secret（`external: true`）；`.env` / `*.pem` / `*.key` / 证书均被 `.gitignore` 排除。
- **公网调用脱敏**：任何发往公网 LLM 的请求，必经 `scrubber` 脱敏并写审计日志；命中 PII 阈值则跳过。
- **合规底线**：代理池仅用于绕开 IP 封禁，**不绕 robots.txt**。
- **数据保留 90 天**：items / item_analysis / item_entities / cluster_items / feedbacks / daily_reports 保留 90 天；配置类（sources / entities / scoring_config / users）永久保留。
- 本仓库已接入 **gitleaks** 扫描（`.gitleaks.toml` + `.github/workflows/secret-scan.yml`）与提交前守卫（`.pre-commit-config.yaml`）。

---

## 许可证

本项目以 **Apache License 2.0** 发布。详见根目录 [`LICENSE`](./LICENSE)。

使用前请留意各信源的使用条款与行业数据合规要求。

---

_FE-Radar · 看得更早，看得更清。_
