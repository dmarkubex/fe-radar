#!/usr/bin/env python3
"""
Create FE-Radar v1.1 Commodity Briefing Linear issues.

Usage:
    LINEAR_API_KEY=lin_api_xxx python3 .ai/scripts/create_v11_issues.py --dry-run
    LINEAR_API_KEY=lin_api_xxx python3 .ai/scripts/create_v11_issues.py --create
    LINEAR_API_KEY=lin_api_xxx python3 .ai/scripts/create_v11_issues.py --relations-only

Idempotent: searches the project for existing issues by title prefix
([V11-XXX] or [T-CB-XX]) and skips them. Writes ID map to
.ai/linear/v1.1-issue-map.json so subsequent runs can fix relations
without recreating issues.

Total issues: 1 epic + 1 human-decision + 1 plan-review + 3 phase + 22 task = 28
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any

API_URL = "https://api.linear.app/graphql"
TEAM_ID = "9e7b6567-4e38-4d14-a75e-ec7ec6f37825"  # DMA / Dmarkubex
PROJECT_ID = "fa1fe194-bc72-457e-a9c0-aa4119732543"  # FE-Radar
STATE_BACKLOG = "cdff2295-d08a-48df-af07-f13b3d306d3d"
LABEL = {
    "codex": "86e53be1-e114-4ebf-9e4b-fd293b487a55",
    "antigravity": "f2c32e9f-76c7-4b8d-b5b0-c8a017496a0f",
    "open-question": "788c3884-8b7b-4268-86cc-9976c251c915",
    "Feature": "caa1d059-88d9-4eb1-af8f-9b3d386631fb",
}
# Priority enum: 0 No, 1 Urgent, 2 High, 3 Medium, 4 Low
PRIO_URGENT, PRIO_HIGH, PRIO_MEDIUM = 1, 2, 3

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MAP_FILE = os.path.join(REPO_ROOT, ".ai", "linear", "v1.1-issue-map.json")


# ---------------------------------------------------------------------------
# Issue data
# ---------------------------------------------------------------------------

V10_BLOCKER_NOTE = (
    "**Blocked by v1.0 release tag v1.0.0 GA**："
    "build-server smoke + Antigravity Gate 2 + Grafana 告警 + MinIO restore "
    "+ Docker Swarm 部署 完成后才能升 Todo。"
)

SPEC_PATHS = (
    "- 需求：`spec/v1.1-commodity-briefing/requirements.md` v0.2 DRAFT\n"
    "- 设计：`spec/v1.1-commodity-briefing/design.md` v0.2 DRAFT\n"
    "- 任务：`spec/v1.1-commodity-briefing/tasks.md` v0.2 DRAFT"
)


def task_body(
    *,
    phase: str,
    agent: str,
    goal: str,
    constraints: list[str],
    scope: list[str],
    acceptance: list[str],
    extra: str = "",
) -> str:
    cs = "\n".join(f"- {c}" for c in constraints)
    sc = "\n".join(f"- `{s}`" for s in scope)
    ac = "\n".join(f"- [ ] {a}" for a in acceptance)
    body = (
        f"**Phase**：{phase}\n"
        f"**Sub-agent**：`{agent}`\n"
        f"**Source**：`spec/v1.1-commodity-briefing/tasks.md`\n\n"
        f"## 目标\n{goal}\n\n"
        f"## 关键约束\n{cs}\n\n"
        f"## Scope（文件清单）\n{sc}\n\n"
        f"## 验收\n{ac}\n"
    )
    if extra:
        body += f"\n## 备注\n{extra}\n"
    body += f"\n---\n\n{V10_BLOCKER_NOTE}\n\n## 配套 spec\n{SPEC_PATHS}\n"
    return body


ISSUES: list[dict[str, Any]] = [
    # ----- Epic / Tracking -------------------------------------------------
    {
        "key": "V11-EPIC",
        "title": "[V11-EPIC] v1.1 Commodity Briefing — 铜锂大宗商品每日简报（3 phase / 22 task）",
        "priority": PRIO_HIGH,
        "labels": ["Feature"],
        "blockedBy": [],
        "body": (
            "## 背景\n"
            "v1.0 是\"看新闻\"，v1.1 是\"看价格\"。每工作日 16:00 自动生成铜（CU）与碳酸锂（LC）每日行情简报，"
            "推送到钉钉工作群，辅助采购 / 销售 / 高层决策。两者复用 sources / pipeline / 关注圈 / LLM / 钉钉通道。\n\n"
            "## 范围\n"
            "- **3 个 phase**：V11-P1 数据通路（9 task） / V11-P2 简报生成与推送（7 task） / V11-P3 UI/监控/验收（6 task）\n"
            "- **22 个 T-CB-XX task**：对齐 `spec/v1.1-commodity-briefing/tasks.md` v0.2\n"
            "- **5 个待决问题**：见 `[V11-Q]` Human-Decision 子 issue\n"
            "- **Plan Review**：见 `[V11-REVIEW]` Antigravity Plan Review 子 issue\n\n"
            "## 产品哲学（沿用 v1.0）\n"
            "1. 信源比信息重要 — 价格信源 T1/T2/T3 分级（交易所 / SMM / 综合财经）\n"
            "2. 能用脚本就别用 Agent — 价格数值禁止 LLM 抽取，support/resistance 由 packages/core 算出，"
            "LLM 仅产 7 段文本（cu/lc logic_summary + cu/lc trend + macro_summary + risk_notes[] + procurement_advice）\n\n"
            "## 状态\n"
            "- spec 三件套已落地 v0.2 DRAFT（requirements / design / tasks）\n"
            "- 5 个待决问题 Q-11G/H/I/J/L 阻塞 Antigravity Plan Review\n"
            "- v1.0 release tag v1.0.0 尚未 GA（build-server 还在跑 deferred empirical）\n\n"
            f"## 配套 spec\n{SPEC_PATHS}\n\n"
            "## 子 issue 树（待创建后回填 ID）\n"
            "- `[V11-Q]` 5 个 v0.2 待决问题（Q-11G/H/I/J/L）—— 用户决策\n"
            "- `[V11-REVIEW]` Antigravity Plan Review v0.2 —— blockedBy V11-Q\n"
            "- `[V11-P1]` 数据通路（T-CB-01..08，9 个 task）\n"
            "- `[V11-P2]` 简报生成与推送（T-CB-09..15，7 个 task）\n"
            "- `[V11-P3]` UI/监控/验收（T-CB-16..21，6 个 task）\n\n"
            "---\n\n"
            f"{V10_BLOCKER_NOTE}\n\n"
            "v1.0 GA 后整个 v1.1 issue 树升 Todo → Codex Execute V11-P1。"
        ),
    },
    {
        "key": "V11-Q",
        "title": "[V11-Q] v1.1 v0.2 spec 5 个待决问题（Q-11G/H/I/J/L）",
        "priority": PRIO_HIGH,
        "labels": ["open-question"],  # Human decision，按 CCB 约定本应不打 label，但用 open-question 帮 Linear 检索
        "blockedBy": [],
        "body": (
            "## 背景\n"
            "v1.1 spec 已迭代到 v0.2，内部 review 关掉 9 条 finding。还剩 5 个**用户决策项**阻塞 Antigravity Plan Review。\n\n"
            "## 5 个待决问题\n\n"
            "### Q-11G 钉钉群机器人凭据由谁提供\n"
            "- 候选 A：采购负责人现有群机器人（复用，最快）\n"
            "- 候选 B：信息中心新建专用群机器人（隔离，安全）\n"
            "- 影响：T-CB-12 / T-CB-18 / 部署期 secrets 文件填充\n\n"
            "### Q-11H docx 模板基线确认\n"
            "- 候选 A：以 2026-05-19 上传的 `铜锂大宗商品·每日行情简报.docx` 为基线\n"
            "- 候选 B：另设计精简版（节省 LLM token）\n"
            "- 影响：T-CB-11 / T-CB-13 / briefing_template_fields seed\n\n"
            "### Q-11I 16:00 推送时间确认\n"
            "- 上期所 15:00 收盘 + 夜盘 21:00 才有完整结算价\n"
            "- 16:00 简报实际是\"日盘收盘价 + 现货早盘报价\"\n"
            "- 决策：是否接受、或推迟到 21:30 出夜盘版（更全但晚）\n"
            "- 影响：T-CB-09 / T-CB-13 / T-CB-14 cron 时间\n\n"
            "### Q-11J 节假日表初始数据\n"
            "- 候选 A：管理员人工录入 2026 全年 11 天\n"
            "- 候选 B：行政部门通用日历同步\n"
            "- 影响：T-CB-03 seed / T-CB-05 isBusinessDay / 上线节假日漏录致空简报风险（风险 R6）\n\n"
            "### Q-11L LLM 月度成本预算切分\n"
            "- NFR-105 Kimi 月度 ≤100 元\n"
            "- 决策：是否计入 v1.0 NFR-05 ≤500 元总预算（合并 / 独立）\n"
            "- 影响：T-CB-19 Grafana 成本面板 / 上线预警阈值\n\n"
            "## 关闭条件\n"
            "- [ ] 5 个问题各有书面决策（在本 issue 评论里 reply）\n"
            "- [ ] Claude Code 把决策内化到 v1.1 spec → bump 到 v0.3\n"
            "- [ ] handoff `§1.1` 状态更新\n\n"
            f"## 配套 spec\n{SPEC_PATHS}\n\n"
            f"---\n\n{V10_BLOCKER_NOTE}"
        ),
    },
    {
        "key": "V11-REVIEW",
        "title": "[V11-REVIEW] Antigravity Plan Review v1.1 v0.2（requirements + design + tasks）",
        "priority": PRIO_URGENT,
        "labels": ["antigravity"],
        "blockedBy": ["V11-Q"],
        "body": (
            "## 背景\n"
            "对齐 v1.0 DMA-24（最终 APPROVED）节奏，v1.1 三件套 spec 一次性提交 Antigravity 做 Plan Review。\n\n"
            "## 评审材料\n"
            "- `spec/v1.1-commodity-briefing/requirements.md` v0.3（在 V11-Q 决策内化后）\n"
            "- `spec/v1.1-commodity-briefing/design.md` v0.3（同上）\n"
            "- `spec/v1.1-commodity-briefing/tasks.md` v0.3（同上，22 task）\n\n"
            "## 重点关注（基于 v1.0 review 历史）\n"
            "- **D 类硬约束闭环**：raw_text strip HTML + ≤2000 字 / scrubber middleware / 数据保留 365 + 90 天 / 节假日跳过\n"
            "- **数值精度审计链**：value/raw_text/observed_at/source_id 是否完整\n"
            "- **LLM 数值幻觉防御**：BRIEFING_SCHEMA 7 段去除 support/resistance / system prompt 5 条硬约束\n"
            "- **钉钉凭据三层防御**：API mask / Pino redact / UI type=password\n"
            "- **migration 双向**：0008 sources.fetcher_type CHECK 扩展 + 0009 seed rollback SQL\n"
            "- **测试不挂 v1.0**：T-CB-21 自检表 `v1.0 测试不挂` 在每个 acceptance\n\n"
            "## 关闭条件\n"
            "- [ ] Antigravity 评审报告产出\n"
            "- [ ] Critical 0 / Major 全部内化或反驳\n"
            "- [ ] Minor 在 V11-P3 收尾期一并修\n"
            "- [ ] tasks.md bump 到 v0.4（review 闭合版）\n\n"
            f"## 配套 spec\n{SPEC_PATHS}\n\n"
            f"---\n\n{V10_BLOCKER_NOTE}"
        ),
    },

    # ----- V11-P1 数据通路 -----------------------------------------------
    {
        "key": "V11-P1",
        "title": "[V11-P1] v1.1 Phase 1 · 数据通路（schema / RSSHub / quotes fetcher）9 task",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-REVIEW"],
        "body": (
            "## 目标\n"
            "落地 v1.1 数据通路：schema 6 张新表 / migration 0008 + 0009 / RSSHub 自部署 / "
            "packages/core briefing 纯函数 / 6 个 quotes adapter + dispatcher 基座 + 应用层 quotes 校验与 admin UI 扩展。\n\n"
            "**目标日期**：2026-06-15\n\n"
            "## task 清单（9 个）\n"
            "- T-CB-01 commodity schema 初版 (agent-db)\n"
            "- T-CB-02a migration 0008 + sources.fetcher_type CHECK 扩展 (agent-db)\n"
            "- T-CB-02b 应用层 quotes Zod schema + admin UI 扩展 (agent-web-api + agent-web-ui)\n"
            "- T-CB-03 commodity seed (信源 + 节假日 + 模板字段) (agent-db)\n"
            "- T-CB-04 RSSHub 自部署 (agent-infra)\n"
            "- T-CB-05 packages/core briefing 纯函数（含 computeSupportResistance）(agent-core)\n"
            "- T-CB-06 quotes fetcher 基座 + types (agent-worker)\n"
            "- T-CB-07 quotes adapters 第一批（shfe / gfex / lme）(agent-worker)\n"
            "- T-CB-08 quotes adapters 第二批（pboc / chinabond / rsshub-extract）(agent-worker)\n\n"
            "## Phase 验收门槛\n"
            "- [ ] 9 个 T-CB-XX 全部 Done\n"
            "- [ ] pnpm -r typecheck/lint/test/build 全绿\n"
            "- [ ] madge --circular packages apps 无新循环\n"
            "- [ ] migration 0008 + 0009 在空库 + 有 v1.0 数据库均跑通；rollback SQL 也跑通\n"
            "- [ ] v1.0 现有 86 tests 不挂\n"
            "- [ ] 6 个 quotes adapter fixture 测试全部 mock 通过（真实 fetch 在 V11-P3 release smoke 验收）\n\n"
            f"---\n\n{V10_BLOCKER_NOTE}\n\n"
            f"## 配套 spec\n{SPEC_PATHS}"
        ),
    },
    {
        "key": "T-CB-01",
        "title": "[T-CB-01] commodity schema 初版（6 张新表 Drizzle）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-REVIEW"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-db",
            goal=(
                "实现 design.md §7.1 全部 6 张新表（commodity_quotes / commodity_briefings / "
                "briefing_targets / briefing_pushes / briefing_holidays / briefing_template_fields）的 Drizzle schema。"
            ),
            constraints=[
                "禁止字符串拼 SQL",
                "全部 timestamp 用 TIMESTAMPTZ",
                "commodity_quotes UNIQUE (metric_key, observed_at)",
                "commodity_quotes.raw_text 应用层写入前必须 strip HTML + 截断 ≤2000 字符（FR-12 沿用）",
                "commodity_briefings.briefing_date UNIQUE",
                "briefing_pushes.briefing_id ON DELETE CASCADE / UNIQUE (briefing_id, target_id)",
                "briefing_template_fields 必须含 exactly_one_source CHECK",
                "不修改 v1.0 已有 schema 文件",
            ],
            scope=[
                "packages/db/src/schema-commodity.ts （新增平级文件）",
                "packages/db/src/index.ts （追加 export，不动 v1.0 export）",
            ],
            acceptance=[
                "drizzle-kit generate 产物与 schema 一致",
                "pnpm -r typecheck 全绿",
                "新增 6 张表能通过 schema.ts 导出",
                "v1.0 schema.ts git diff = 0",
            ],
        ),
    },
    {
        "key": "T-CB-02a",
        "title": "[T-CB-02a] migration 0008 + sources.fetcher_type CHECK 扩展",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-REVIEW", "T-CB-01"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-db",
            goal=(
                "落地 0008_commodity_briefing.sql migration（6 张新表 + sources.fetcher_type CHECK "
                "扩展为 rss/html/playwright/quotes），含 rollback SQL。"
            ),
            constraints=[
                "用 ALTER CONSTRAINT 不要 DROP 整张表",
                "新表 CREATE 后必须能在空库连续跑两次 idempotent（IF NOT EXISTS）",
                "rollback SQL 必须一同提交",
                "禁止修改 v1.0 已有 migration（0001..0007）",
            ],
            scope=[
                "packages/db/migrations/0008_commodity_briefing.sql",
                "packages/db/migrations/0008_commodity_briefing.down.sql",
            ],
            acceptance=[
                "drizzle-kit migrate up 在空库 + 有 v1.0 数据库均成功",
                "v1.0 sources 行不丢、不动 fetcher_type 值",
                "psql `\\d+ commodity_quotes` 显示全部约束与索引",
                "drizzle-kit migrate down 0008 也能跑通",
            ],
        ),
    },
    {
        "key": "T-CB-02b",
        "title": "[T-CB-02b] 应用层 quotes Zod schema + admin sources UI 扩展",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-02a"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-web-api + agent-web-ui",
            goal=(
                "扩展 `apps/web/lib/api/sources-schema.ts` fetcherType enum 增加 'quotes' case + admin source-form 支持 "
                "quotes 类型字段，让 DB CHECK 扩展能经现有 admin /api/sources + /admin/sources 路径管理。"
            ),
            constraints=[
                "sources-schema.ts fetcherType enum 当前仅 rss/html/playwright（line 4），扩展为 +'quotes'",
                "discriminated union 加 quotes case：config 校验 {adapter enum, metric_keys, endpoint, retry, regex_rules?}",
                "admin source-form 必须能选 'quotes' 类型并显示对应 config 字段；adapter 用 select（shfe/gfex/lme/pboc/chinabond/rsshub-extract）",
                "禁止破坏 v1.0 rss/html/playwright 三个 case 的字段渲染与校验",
                "UI 编辑已有信源时禁用类型切换（不能把 rss/html/playwright 改成 quotes）",
            ],
            scope=[
                "apps/web/lib/api/sources-schema.ts",
                "apps/web/lib/api/__tests__/sources-schema.test.ts",
                "apps/web/app/(admin)/admin/sources/source-form.tsx",
                "apps/web/e2e/admin-sources-quotes.spec.ts",
            ],
            acceptance=[
                "Zod 单测：fetcher_type='quotes' + 合法 config → parse 成功；非法 adapter / 缺 metric_keys / 缺 endpoint → 失败带 path",
                "admin e2e：admin 登录后能在 /admin/sources 新建 1 条 fetcher_type='quotes' 信源（adapter=shfe, metric_keys=[cu_main_close]），列表正确显示",
                "v1.0 rss/html/playwright 信源 CRUD e2e 无回归",
                "敏感字段（type=password / sign_secret）渲染不变",
            ],
            extra="依赖 T-CB-02a：DB CHECK 必须先扩展，Zod 才能写 quotes 而不被数据库回写时拒绝。",
        ),
    },
    {
        "key": "T-CB-03",
        "title": "[T-CB-03] commodity seed（信源 + 节假日 + 模板字段）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-02a"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-db",
            goal="落地 0009 seed migration：v1.1 信源（§5）+ 2026 节假日表 + 默认 briefing_template_fields 映射。",
            constraints=[
                "ON CONFLICT DO NOTHING（idempotent）",
                "fetcher_type='quotes' 的信源 seed 默认 enabled=false（等 adapter 上线再 enable）",
                "节假日表只放 2026 年 11 个法定节假日（admin 后续年度维护）",
                "briefing_template_fields seed 与 §7.1 占位符命名一致",
                "不能放 seed.local.sql",
            ],
            scope=[
                "packages/db/migrations/0009_commodity_seed.sql",
                "packages/db/scripts/seed-commodity.ts （可选本地 dev TS 脚本）",
            ],
            acceptance=[
                "migration 跑后 sources 表多 12 行（§5）",
                "briefing_holidays 11 行",
                "briefing_template_fields ≥ 40 行（覆盖 docx 全部占位符）",
                "重跑 migration 不重复插入",
            ],
            extra="**待 Q-11J 决策**：节假日表数据由谁录入。",
        ),
    },
    {
        "key": "T-CB-04",
        "title": "[T-CB-04] RSSHub 自部署（diygod/rsshub）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-REVIEW"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-infra",
            goal="deploy/stack.yml 追加 rsshub 服务（diygod/rsshub），内网 only，Redis 缓存。",
            constraints=[
                "不映射主机端口（仅 networks: [internal]）",
                "TZ=Asia/Shanghai 注入",
                "不影响 v1.0 已有服务（diff 仅追加 rsshub 块 + worker environment 追加 RSSHUB_BASE_URL）",
                "镜像版本 pin 到具体 digest，不用 :latest",
            ],
            scope=[
                "deploy/stack.yml",
                "deploy/README.md",
            ],
            acceptance=[
                "docker stack deploy 后 rsshub 容器 running",
                "worker 容器内 curl rsshub:1200/smm/news/cu 返回 RSS XML",
                "rsshub 容器无端口暴露到主机",
                "v1.0 已有服务健康检查全绿",
            ],
        ),
    },
    {
        "key": "T-CB-05",
        "title": "[T-CB-05] packages/core briefing 纯函数（含 computeSupportResistance）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-REVIEW"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-core",
            goal=(
                "实现涨跌计算 / 模板字段映射 / 节假日判定 / 字段缺失降级 / 支撑位压力位计算的纯函数。"
                "其中 computeSupportResistance 用 design §6.5 pivot ± 0.382 × range 公式（基于近 20 交易日 high/low/close）。"
            ),
            constraints=[
                "禁止依赖 packages/db（保持 core 纯函数）",
                "dayjs 必须用 packages/shared/dayjs（Asia/Shanghai 已注入）",
                "isBusinessDay(date, holidaySet) 用集合查询；不要在函数内查 DB",
                "computeSupportResistance 样本 < 10 → 返 { support: null, resistance: null }",
                "纯函数禁用 LLM / 网络 / 文件 IO",
                "Vitest 覆盖率 ≥ 90%",
            ],
            scope=[
                "packages/core/src/briefing.ts",
                "packages/core/src/index.ts",
                "packages/core/src/__tests__/briefing.test.ts",
            ],
            acceptance=[
                "Vitest 覆盖率 ≥ 90%",
                "isBusinessDay(2026-06-08, holidays={2026-06-08}) === false",
                "computeChangePct(78520, 78268) ≈ 0.32",
                "computeSupportResistance(近 20 日 CU fixture) 输出整数 support < resistance；样本 = 8 → 两值均为 null",
                "madge --circular packages/core 无循环",
            ],
        ),
    },
    {
        "key": "T-CB-06",
        "title": "[T-CB-06] quotes fetcher 基座 + QuotesAdapter types",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-02b"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-worker",
            goal="实现 quotes fetcher 基座（QuotesAdapter 接口 + dispatcher），与 rss/html/playwright fetcher 并列。",
            constraints=[
                "新 fetcher_type='quotes' dispatcher 入口在 apps/worker/src/fetchers/index.ts（追加 case，不改其他）",
                "QuotesAdapter 接口 + QuoteSample 类型放 fetchers/quotes/types.ts",
                "Adapter 失败必须返回 [] 不抛异常；上层捕获并 markSourceFailure",
                "禁止在 fetcher 层调 LLM（NFR-102 数值精度敏感）",
            ],
            scope=[
                "apps/worker/src/fetchers/quotes.ts （dispatcher）",
                "apps/worker/src/fetchers/quotes/types.ts",
                "apps/worker/src/fetchers/index.ts",
                "apps/worker/src/fetchers/__tests__/quotes.test.ts",
            ],
            acceptance=[
                "Vitest 覆盖率 ≥ 85%",
                "Mock adapter 跑通端到端",
                "dispatcher 对未知 adapter 名称 throw FETCH_ADAPTER_UNKNOWN",
                "v1.0 fetcher 测试不挂",
            ],
        ),
    },
    {
        "key": "T-CB-07",
        "title": "[T-CB-07] quotes adapters 第一批（shfe / gfex / lme）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-06"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-worker",
            goal=(
                "实现 3 个 T1 数值源 adapter：上期所沪铜主力 / 广期所碳酸锂主力 / LME 伦铜；含仓单。"
            ),
            constraints=[
                "每个 adapter 用真实 fixture 写 fetch 测试（__tests__/fixtures/）",
                "禁止用 LLM 抽数值",
                "解析失败必须保留 raw_text；raw_text strip HTML + ≤2000 字符",
                "走 v1.0 已有 http.ts（含 proxy 池 + UA 池 + robots）",
                "同站请求 ≥ 1s 间隔",
            ],
            scope=[
                "apps/worker/src/fetchers/quotes/shfe.ts",
                "apps/worker/src/fetchers/quotes/gfex.ts",
                "apps/worker/src/fetchers/quotes/lme.ts",
                "apps/worker/src/fetchers/quotes/__tests__/*.test.ts",
                "apps/worker/src/fetchers/quotes/__tests__/fixtures/**",
            ],
            acceptance=[
                "Vitest 全绿（3 adapter × 2 测试 = 6 用例最少）",
                "fixture 解析输出与预期 QuoteSample[] 完全一致",
                "网络异常路径返回空数组 + 不抛异常",
                "TypeScript strict 模式无 any",
            ],
        ),
    },
    {
        "key": "T-CB-08",
        "title": "[T-CB-08] quotes adapters 第二批（pboc / chinabond / rsshub-extract）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-06", "T-CB-04"],
        "body": task_body(
            phase="V11-P1",
            agent="agent-worker",
            goal=(
                "实现央行汇率中间价 / 中国货币网 10Y 国债 / RSSHub 数值正则抽取 3 个 adapter。"
            ),
            constraints=[
                "rsshub-extract 用 sources.config.regex_rules 数组逐条尝试匹配",
                "正则未命中必须 value=null 并保留 raw_text，禁止 LLM fallback",
                "raw_text 写入前必经 sanitize-html strip 标签 + 截断 ≤2000 字符",
                "央行 / 货币网 走 html fetcher 基座",
                "命中失败连续 3 日 → enqueue admin 黄色告警（NFR-104）",
            ],
            scope=[
                "apps/worker/src/fetchers/quotes/pboc.ts",
                "apps/worker/src/fetchers/quotes/chinabond.ts",
                "apps/worker/src/fetchers/quotes/rsshub-extract.ts",
                "apps/worker/src/fetchers/quotes/__tests__/*.test.ts",
                "apps/worker/src/fetchers/quotes/__tests__/fixtures/**",
            ],
            acceptance=[
                "3 adapter Vitest 全绿",
                "regex 未命中样本测试中 value=null 不抛异常",
                "rsshub-extract 至少覆盖 SMM 铜 / SMM 锂 / 生意社纯碱 3 个真实 fixture",
            ],
        ),
    },

    # ----- V11-P2 简报生成与推送 -----------------------------------------
    {
        "key": "V11-P2",
        "title": "[V11-P2] v1.1 Phase 2 · 简报生成与推送（LLM / docx / 钉钉机器人）7 task",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1"],
        "body": (
            "## 目标\n"
            "把 V11-P1 落地的数据通路串成端到端简报：quotes-fetch 拉数 → briefing-gen LLM 7 段 + 代码注入 s/r → docx → "
            "briefing-push 钉钉群机器人。\n\n"
            "**目标日期**：2026-06-26\n\n"
            "## task 清单（7 个）\n"
            "- T-CB-09 quotes-fetch job 上线（工作日 15:30）(agent-worker)\n"
            "- T-CB-10 BRIEFING_SCHEMA + Kimi system prompt + buildBriefingInput (agent-llm)\n"
            "- T-CB-11 docx 渲染封装（docxtemplater + MinIO） (agent-worker)\n"
            "- T-CB-12 钉钉群机器人 SDK（加签 + actionCard）(agent-worker)\n"
            "- T-CB-13 briefing-gen job（工作日 16:00 · 5 步 + step 3.5）(agent-worker)\n"
            "- T-CB-14 briefing-push job（工作日 16:05）(agent-worker)\n"
            "- T-CB-15 cleanup job 扩展（quotes 365 天 / briefings 90 天）(agent-infra)\n\n"
            "## Phase 验收门槛\n"
            "- [ ] 7 个 T-CB-XX 全部 Done\n"
            "- [ ] pnpm -r typecheck/lint/test/build 全绿\n"
            "- [ ] briefing-gen 端到端 Vitest 通过：mock adapter→quotes 入库→mock Kimi(7 段)→注入 s/r→docx→MinIO upload→DB INSERT\n"
            "- [ ] 节假日跳过：3 个 job 全部 early-return + 结构化日志\n"
            "- [ ] 钉钉 webhook URL/sign_secret 在 captured logs 中为 [REDACTED]\n"
            "- [ ] v1.0 已有测试不挂\n\n"
            f"---\n\n{V10_BLOCKER_NOTE}\n\n"
            f"## 配套 spec\n{SPEC_PATHS}"
        ),
    },
    {
        "key": "T-CB-09",
        "title": "[T-CB-09] quotes-fetch job 上线（工作日 15:30 cron）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1", "T-CB-07", "T-CB-08", "T-CB-03"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-worker",
            goal=(
                "实现 quotes-fetch BullMQ job + scheduler cron，把全部 quotes adapter 端到端串起来写入 commodity_quotes。"
            ),
            constraints=[
                "并发=5（沿用 v1.0 FETCH_CONCURRENCY）",
                "失败计入 sources.fail_count，连续 7 失败自动 disable",
                "upsert by UNIQUE (metric_key, observed_at)",
                "节假日跳过（先调 packages/core isBusinessDay）",
                "禁止在 job 内调 LLM",
            ],
            scope=[
                "apps/worker/src/jobs/quotes-fetch.ts",
                "apps/worker/src/scheduler.ts",
                "apps/worker/src/queues.ts",
                "apps/worker/src/__tests__/quotes-fetch.test.ts",
            ],
            acceptance=[
                "测试 Postgres 端到端：mock adapter → upsert → SELECT 验证",
                "节假日测试：当日 holiday → job return 0 rows",
                "失败注入：单 adapter throw → fail_count++，其他 source 不受影响",
                "v1.0 fetcher job 测试不挂",
            ],
        ),
    },
    {
        "key": "T-CB-10",
        "title": "[T-CB-10] BRIEFING_SCHEMA + Kimi system prompt（7 段 LLM 产出）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-llm",
            goal=(
                "实现 BRIEFING_SCHEMA（7 段 LLM 产出 · 不含数值字段）、system prompt、buildBriefingInput，并与 withScrubber 集成。"
            ),
            constraints=[
                "schema 严格按 design §6.1：cu.outlook 与 lc.outlook 仅含 trend (enum)，不含 support/resistance（数值由 T-CB-05 代码计算后注入 payload_json）",
                "schema 共 7 段：cu.logic_summary / cu.outlook.trend / lc.logic_summary / lc.outlook.trend / macro_summary / risk_notes[] / procurement_advice (enum)",
                "system prompt 必须包含 design §6.2 全部 5 条硬约束（禁虚构数值 / 禁投资意见 / 禁价格数值字段 / logic_summary 不预测未来价位 / JSON schema 失败丢弃）",
                "禁止把 v1.0 DAILY_REPORT_SCHEMA 改坏",
                "withScrubber 集成沿用 v1.0 packaging",
            ],
            scope=[
                "packages/llm/src/briefing-schema.ts",
                "packages/llm/src/index.ts",
                "packages/llm/src/__tests__/briefing-schema.test.ts",
            ],
            acceptance=[
                "schema validation 7 段全部字段（合法 / 缺字段 / 数值幻觉如 outlook 出现 support 字段 / procurement_advice 越界）全绿",
                "withScrubber 集成测试：mock Kimi 返回合法 7 段 JSON → 结构化解析成功",
                "withScrubber PII 命中：mock 输入含手机号 → 跳过 LLM + 写 scrubber audit log",
                "TypeScript 类型 Briefing 推导不含 outlook.support / outlook.resistance",
            ],
        ),
    },
    {
        "key": "T-CB-11",
        "title": "[T-CB-11] docx 渲染封装（docxtemplater + MinIO + 模板 lint）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1", "T-CB-03"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-worker",
            goal="实现 apps/worker/src/lib/briefing-render.ts，封装 docxtemplater + 模板 lint + MinIO 上传。",
            constraints=[
                "禁止把模板路径硬编码；从 process.env.BRIEFING_TEMPLATE_PATH 读",
                "渲染前先 lint：模板中所有 {{key}} 必须能在 briefing_template_fields 表里找到",
                "MinIO bucket 用 process.env.BRIEFING_MINIO_BUCKET",
                "docx 文件名固定为 briefing-YYYYMMDD.docx",
                "渲染失败必须 throw BriefingRenderError（packages/shared/errors.ts 新增）",
            ],
            scope=[
                "apps/worker/src/lib/briefing-render.ts",
                "apps/worker/src/lib/__tests__/briefing-render.test.ts",
                "packages/shared/src/errors.ts",
                "design/templates/briefing.docx",
            ],
            acceptance=[
                "Vitest 全绿（模板 lint / 渲染成功 / MinIO 失败 mock）",
                "新增 BriefingRenderError instanceof AppError === true",
                "docx 渲染产物用 unzip 解开能看到填充后的占位值",
            ],
            extra="**待 Q-11H 决策**：docx 模板基线是否以 2026-05-19 上传版本为准。",
        ),
    },
    {
        "key": "T-CB-12",
        "title": "[T-CB-12] 钉钉群机器人 SDK（加签 + actionCard / text / markdown）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-worker",
            goal="实现 apps/worker/src/lib/dingtalk-bot.ts，支持加签 + actionCard/text/markdown 消息。",
            constraints=[
                "加签算法严格按 design §10.2",
                "禁止把 webhook URL / sign secret 写入日志（Pino redact 配置）",
                "HTTP timeout 10s，失败必须 throw DingtalkBotError（packages/shared 新增）",
                "禁止任何外发请求绕过 v1.0 Pino logger",
            ],
            scope=[
                "apps/worker/src/lib/dingtalk-bot.ts",
                "apps/worker/src/lib/__tests__/dingtalk-bot.test.ts",
                "packages/shared/src/errors.ts",
                "apps/worker/src/logger.ts",
            ],
            acceptance=[
                "加签输出与官方文档 reference vector 一致",
                "Pino 日志中 webhook_url / sign_secret 字段为 [REDACTED]",
                "5xx 测试：mock fetch → 3 retry → throw DingtalkBotError",
            ],
            extra="**待 Q-11G 决策**：钉钉群机器人 webhook 凭据来源。",
        ),
    },
    {
        "key": "T-CB-13",
        "title": "[T-CB-13] briefing-gen job（工作日 16:00 · 5 步 + step 3.5 注入 s/r）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-05", "T-CB-09", "T-CB-10", "T-CB-11"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-worker",
            goal=(
                "实现 briefing-gen BullMQ job + scheduler cron，串起 precheck → context → LLM(7 段) → "
                "代码注入 support/resistance → docx → 落库（design §5.2）。"
            ),
            constraints=[
                "调 LLM 必经 withScrubber",
                "precheck 字段覆盖率 < 5 → 延迟 5min 重试 ×2 → 仍不足则 gen_status=degraded",
                "step 3 LLM 仅 7 段（T-CB-10 schema）",
                "step 3.5 必须调 packages/core computeSupportResistance() 算出 cu/lc 的 support/resistance，merge 入 payload_json.{cu,lc}.outlook；LLM 输出若漏出该字段则丢弃",
                "节假日跳过（packages/core isBusinessDay）",
                "成功后 enqueue briefing-push job",
                "禁止使用 v1.0 daily-gen 同名变量名",
            ],
            scope=[
                "apps/worker/src/jobs/briefing-gen.ts",
                "apps/worker/src/scheduler.ts",
                "apps/worker/src/queues.ts",
                "apps/worker/src/__tests__/briefing-gen.test.ts",
            ],
            acceptance=[
                "Vitest 端到端：mock adapter→quotes 入库→mock Kimi(7 段)→注入 s/r→docx→MinIO upload→DB INSERT，全绿",
                "step 3.5：mock 20 日序列 → payload_json.cu.outlook.{support,resistance} 为整数；序列 8 项 → 两值 null + docx fallback '—'",
                "Degraded 路径：仅 3 字段入库 → gen_status='degraded' + payload_json 含 fallback",
                "节假日跳过：briefing_holidays 含当日 → job return",
                "重复触发同一日：UNIQUE (briefing_date) 冲突 → 返回已有 id 不重新生成",
            ],
            extra="**待 Q-11I 决策**：16:00 cron 时间是否接受（vs 推迟到 21:30 出夜盘版）。",
        ),
    },
    {
        "key": "T-CB-14",
        "title": "[T-CB-14] briefing-push job（工作日 16:05 · 钉钉群机器人）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-12", "T-CB-13"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-worker",
            goal="实现 briefing-push BullMQ job + scheduler cron，把简报推送到全部启用的 briefing_targets。",
            constraints=[
                "并发=3（避免钉钉单 IP 限流）",
                "失败指数退避 ×3",
                "最终成功/失败状态写 briefing_pushes 表",
                "钉钉 webhook 凭据不出现在日志",
                "推送内容默认 actionCard + 站内深链（design §10.3）",
            ],
            scope=[
                "apps/worker/src/jobs/briefing-push.ts",
                "apps/worker/src/scheduler.ts",
                "apps/worker/src/queues.ts",
                "apps/worker/src/__tests__/briefing-push.test.ts",
            ],
            acceptance=[
                "Vitest 全绿（成功 / 部分失败 / 全失败 / 无 target）",
                "失败 3 次后 push_status='failed' + 红色告警 enqueue（mock）",
                "钉钉 webhook URL 不出现在 captured logs",
                "重复推同一 (briefing_id, target_id) 跳过（UNIQUE 约束）",
            ],
        ),
    },
    {
        "key": "T-CB-15",
        "title": "[T-CB-15] cleanup job 扩展（quotes 365 天 / briefings 90 天）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P1"],
        "body": task_body(
            phase="V11-P2",
            agent="agent-infra",
            goal="v1.0 cleanup job 追加两条 DELETE：commodity_quotes 365 天 / commodity_briefings 90 天。",
            constraints=[
                "事务内执行；FK 已由 briefing_pushes ON DELETE CASCADE 处理",
                "不影响 v1.0 既有 DELETE 行为",
                "MinIO docx 文件清理由 MinIO bucket lifecycle policy 处理（不在 cleanup job 里删 MinIO）",
                "DELETE 计数写结构化日志",
            ],
            scope=[
                "apps/worker/src/jobs/cleanup.ts",
                "apps/worker/src/jobs/__tests__/cleanup.test.ts",
            ],
            acceptance=[
                "测试库 fixture：365 天前 quotes / 90 天前 briefings → cleanup 后被删",
                "FK 级联：删 briefings 时 briefing_pushes 行被 CASCADE 删除",
                "v1.0 cleanup 测试全部仍通过",
                "结构化日志包含 deleted_count for each table",
            ],
        ),
    },

    # ----- V11-P3 UI/监控/验收 ------------------------------------------
    {
        "key": "V11-P3",
        "title": "[V11-P3] v1.1 Phase 3 · 前端 / 后台 / 监控 / 验收 6 task",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P2"],
        "body": (
            "## 目标\n"
            "暴露 v1.1 给最终用户：/briefing 列表+详情 / /admin/briefing/targets / Grafana 5 面板 / release smoke 扩展 / runbook。\n\n"
            "**目标日期**：2026-07-05\n\n"
            "## task 清单（6 个）\n"
            "- T-CB-16 /api/briefing/* Route Handlers（含 FR-110 download + 410 Gone）(agent-web-api)\n"
            "- T-CB-17 /briefing 列表 + 详情页 (agent-web-ui)\n"
            "- T-CB-18 /admin/briefing/targets 后台 (agent-web-ui)\n"
            "- T-CB-19 Grafana 监控面板扩展（5 面板 + 告警）(agent-infra)\n"
            "- T-CB-20 release smoke 扩展（合并到 v1.0.1 patch）(agent-infra)\n"
            "- T-CB-21 v1.1 文档与上线 runbook (agent-infra)\n\n"
            "## Phase 验收门槛\n"
            "- [ ] 6 个 T-CB-XX 全部 Done\n"
            "- [ ] 12 项验收（requirements §12）全过\n"
            "- [ ] Antigravity Code Review 无 Critical\n"
            "- [ ] build-server release smoke 全绿（含 @v11 4 用例 + v1.0 已有 release-smoke）\n"
            "- [ ] handoff.md §1.1 v1.1 stream 升 Release / Done\n"
            "- [ ] CLAUDE.md PROJECT 段追加 v1.1 章节\n\n"
            f"---\n\n{V10_BLOCKER_NOTE}\n\n"
            f"## 配套 spec\n{SPEC_PATHS}"
        ),
    },
    {
        "key": "T-CB-16",
        "title": "[T-CB-16] /api/briefing/* Route Handlers（含 FR-110 download 410 Gone）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["V11-P2", "T-CB-13"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-web-api",
            goal=(
                "实现 design §8 全部 10 个 API 端点（含 GET /api/briefing/:id/download）+ Zod 校验 + RBAC + 错误结构 + "
                "FR-110 410 Gone 语义。"
            ),
            constraints=[
                "用 v1.0 已有 RBAC 中间件，不重写",
                "Zod schema 输入校验严格",
                "错误响应严格遵循 v1.0 格式：{ error: { code, message, details? } }",
                "GET download：不存在 → 404；存在但 briefing_date < now-90d 或 MinIO headObject 404 → 410 Gone + code='BRIEFING_DOCX_EXPIRED'；命中则流式返 docx",
                "GET targets 返回 sign_secret 必须 mask 为 '***'",
                "POST regenerate / repush 用 BullMQ enqueue，不在 HTTP 同步等待",
            ],
            scope=[
                "apps/web/app/api/briefing/route.ts",
                "apps/web/app/api/briefing/[id]/route.ts",
                "apps/web/app/api/briefing/[id]/download/route.ts",
                "apps/web/app/api/briefing/[id]/regenerate/route.ts",
                "apps/web/app/api/briefing/[id]/repush/route.ts",
                "apps/web/app/api/briefing/targets/route.ts",
                "apps/web/app/api/briefing/targets/[id]/route.ts",
                "apps/web/app/api/briefing/targets/[id]/test/route.ts",
                "apps/web/app/api/briefing/__tests__/**",
            ],
            acceptance=[
                "Vitest 全绿（≥ 20 用例，含 download happy / 410 expired / 404 not-found）",
                "viewer 调 POST regenerate → 403",
                "validation fail：缺字段 → 400 + Zod error details",
                "sign_secret mask：响应 JSON 含 '***'，不含真值",
                "FR-110：briefing_date=91 天前 → GET download 返 410 + code='BRIEFING_DOCX_EXPIRED'（不是 404，不是 200）",
                "FR-110 边界：briefing_date=90 天前（含当日）→ 200 流式返 docx",
            ],
        ),
    },
    {
        "key": "T-CB-17",
        "title": "[T-CB-17] /briefing 列表 + /briefing/[id] 详情页（含 7 日折线）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-16"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-web-ui",
            goal=(
                "实现 /briefing 列表（倒序时间线）+ /briefing/[id] 详情页（含 payload_json 可视化 + 推送状态 + 7 日折线）。"
            ),
            constraints=[
                "RSC 默认 + 客户端组件仅用于交互（图表 / 重新生成按钮）",
                "折线图用 recharts（v1.0 已引入）",
                "TanStack Query 走 v1.0 已有配置",
                "导航增项只追加一行 <Link>，不改其他菜单",
                "briefing 不存在 → 404（防枚举）",
                ">90 天 docx 已 retention 清理 → 详情页可访问但下载按钮触发的 download API 返 410 Gone；UI 灰态显示'已过保留期'",
            ],
            scope=[
                "apps/web/app/briefing/page.tsx",
                "apps/web/app/briefing/[id]/page.tsx",
                "apps/web/components/briefing/**",
                "apps/web/components/nav/* （仅追加链接）",
                "apps/web/e2e/briefing.spec.ts",
            ],
            acceptance=[
                "Playwright e2e 全绿（列表分页 / 详情 404 / 重新生成按钮 disabled when status=pending / 90 天外灰态 + 下载按钮触发 410）",
                "Lighthouse perf ≥ 80（与 v1.0 一致）",
                "RSC：列表页 server-rendered（首屏 HTML 已含数据）",
                "导航增项在 RBAC viewer 可见，admin 多见 /admin/briefing/targets 入口",
            ],
        ),
    },
    {
        "key": "T-CB-18",
        "title": "[T-CB-18] /admin/briefing/targets 后台（CRUD + 测试推送）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-16"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-web-ui",
            goal="实现 /admin/briefing/targets 列表 + 新增 / 编辑 / 删除 / 测试推送。",
            constraints=[
                "admin only（middleware 守卫 + UI 防御性 RBAC 双层）",
                "sign_secret 输入框 type='password'，编辑时显示掩码不显示真值",
                "测试推送按钮调 POST /api/briefing/targets/:id/test，结果用 toast 展示",
                "删除走软确认（需用户输入 target 名再确认），不能误删",
            ],
            scope=[
                "apps/web/app/(admin)/admin/briefing/targets/page.tsx",
                "apps/web/components/briefing/target-form.tsx",
                "apps/web/e2e/admin-briefing-targets.spec.ts",
            ],
            acceptance=[
                "Playwright e2e 全绿（CRUD × 角色矩阵 × 测试推送）",
                "viewer 直接访问 URL → 重定向到 /auth/login",
                "editor 访问 → 403 page",
                "sign_secret 字段在 HTML 中不可读（type=password + 服务端 mask）",
            ],
        ),
    },
    {
        "key": "T-CB-19",
        "title": "[T-CB-19] Grafana 监控面板扩展（5 面板 + 4 告警规则）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-13", "T-CB-14"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-infra",
            goal="deploy/grafana/dashboards 新增 v1.1 commodity-briefing 仪表盘 + provisioning 注册。",
            constraints=[
                "不改 v1.0 dashboard JSON",
                "新 dashboard 标 tag='v1.1'",
                "5 个面板（design §15）：gen 成功率 / push 成功率 / 字段覆盖率 / quotes 时延 / Kimi 月度成本",
                "告警规则放 alerts/commodity-briefing.yaml",
            ],
            scope=[
                "deploy/grafana/dashboards/commodity-briefing.json",
                "deploy/grafana/provisioning/alerts/commodity-briefing.yaml",
                "deploy/grafana/README.md",
            ],
            acceptance=[
                "Grafana provisioning lint pass",
                "面板在 Grafana 加载无报错（手工验收）",
                "4 条告警规则可触发（fixture mock）",
                "v1.0 dashboard 完全未变动",
            ],
            extra="**待 Q-11L 决策**：Kimi 月度成本是否计入 v1.0 NFR-05 总预算。",
        ),
    },
    {
        "key": "T-CB-20",
        "title": "[T-CB-20] release smoke 扩展（@v11 4 用例并入 v1.0.1 patch）",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-17", "T-CB-19"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-infra",
            goal=(
                "在 v1.0 release smoke spec 基础上追加 v1.1 端到端烟雾测试（不分裂为独立 release v1.1.0，与 v1.0.1 patch 一同测试）。"
            ),
            constraints=[
                "不改 v1.0 已有 release-smoke spec 用例",
                "新用例 tag='@v11'",
                "覆盖：节假日跳过 / 字段缺失降级 / 推送失败重试 / 模板 lint 失败",
                "docs/release/v1.1.0-smoke.md 文档",
            ],
            scope=[
                "apps/web/e2e/release-smoke.spec.ts",
                "docs/release/v1.1.0-smoke.md",
                "scripts/v11-smoke-prep.ts",
            ],
            acceptance=[
                "v1.0 已有 release smoke 用例全部仍通过",
                "新 @v11 用例 4 项全绿（在 build server 环境验收）",
                "docs 文档对齐 v1.0 release 文档风格",
            ],
        ),
    },
    {
        "key": "T-CB-21",
        "title": "[T-CB-21] v1.1 文档与上线 runbook + handoff.md 同步",
        "priority": PRIO_URGENT,
        "labels": ["codex"],
        "blockedBy": ["T-CB-20"],
        "body": task_body(
            phase="V11-P3",
            agent="agent-infra",
            goal="更新 CLAUDE.md PROJECT 段 + 写 v1.1 runbook + handoff.md 同步到 v1.1 Release。",
            constraints=[
                "CLAUDE.md 只追加 v1.1 模块说明，不重写已有 v1.0 内容",
                "runbook 含：节假日表年度维护 / 钉钉 webhook 凭据轮换 / 模板 docx 改版流程 / 失败重推 SOP",
                "handoff.md 同步 v1.1 进入 Release 阶段 + Owner=Human/Build Server",
            ],
            scope=[
                "CLAUDE.md（PROJECT 段追加 v1.1 章节）",
                "docs/runbook/v1.1-commodity-briefing.md",
                "handoff.md",
            ],
            acceptance=[
                "CLAUDE.md grep 'v1.1' 命中新增段",
                "runbook 4 个 SOP 完整可执行",
                "handoff.md Current Control 行更新到 v1.1 Release",
            ],
        ),
    },
]


# ---------------------------------------------------------------------------
# GraphQL helpers
# ---------------------------------------------------------------------------

def gql(query: str, variables: dict | None = None) -> dict:
    api_key = os.environ.get("LINEAR_API_KEY")
    if not api_key:
        raise SystemExit("ERROR: LINEAR_API_KEY env var is required")
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": api_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {e.code}: {body[:500]}")
    if "errors" in data:
        raise SystemExit("GraphQL errors:\n" + json.dumps(data["errors"], indent=2, ensure_ascii=False))
    return data["data"]


def list_project_issues() -> list[dict]:
    out: list[dict] = []
    cursor: str | None = None
    while True:
        q = """
        query($pid: String!, $after: String) {
          project(id: $pid) {
            issues(first: 100, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { id identifier title url }
            }
          }
        }
        """
        d = gql(q, {"pid": PROJECT_ID, "after": cursor})
        page = d["project"]["issues"]
        out.extend(page["nodes"])
        if not page["pageInfo"]["hasNextPage"]:
            break
        cursor = page["pageInfo"]["endCursor"]
    return out


def list_issue_relations(issue_id: str) -> list[dict]:
    q = """
    query($id: String!) {
      issue(id: $id) {
        relations { nodes { id type relatedIssue { id identifier } } }
        inverseRelations { nodes { id type issue { id identifier } } }
      }
    }
    """
    d = gql(q, {"id": issue_id})
    return d["issue"]


def create_issue(spec: dict) -> dict:
    label_ids = [LABEL[name] for name in spec["labels"]]
    variables = {
        "input": {
            "teamId": TEAM_ID,
            "projectId": PROJECT_ID,
            "stateId": STATE_BACKLOG,
            "title": spec["title"],
            "description": spec["body"],
            "priority": spec["priority"],
            "labelIds": label_ids,
        }
    }
    m = """
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }
    """
    d = gql(m, variables)
    if not d["issueCreate"]["success"]:
        raise SystemExit(f"Failed to create {spec['key']}")
    return d["issueCreate"]["issue"]


def create_relation(blocker_id: str, blocked_id: str) -> None:
    m = """
    mutation($input: IssueRelationCreateInput!) {
      issueRelationCreate(input: $input) {
        success
        issueRelation { id type }
      }
    }
    """
    # Linear semantics: type "blocks" means issueId blocks relatedIssueId
    d = gql(m, {"input": {"issueId": blocker_id, "relatedIssueId": blocked_id, "type": "blocks"}})
    if not d["issueRelationCreate"]["success"]:
        raise SystemExit(f"Failed to create relation {blocker_id} blocks {blocked_id}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_existing_map() -> dict:
    if os.path.exists(MAP_FILE):
        with open(MAP_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_map(m: dict) -> None:
    os.makedirs(os.path.dirname(MAP_FILE), exist_ok=True)
    with open(MAP_FILE, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)


def match_existing(existing: list[dict], spec: dict) -> dict | None:
    # Match by exact title or by [KEY] prefix
    title = spec["title"]
    key_prefix = title.split("]", 1)[0] + "]"  # e.g. "[V11-EPIC]"
    for e in existing:
        if e["title"] == title:
            return e
        if e["title"].startswith(key_prefix + " ") and spec["key"] in e["title"]:
            return e
    return None


def main() -> None:
    args = sys.argv[1:]
    dry_run = "--dry-run" in args
    relations_only = "--relations-only" in args
    do_create = "--create" in args or relations_only
    if not (dry_run or do_create):
        print(__doc__)
        sys.exit(1)

    # Validate API key
    if not os.environ.get("LINEAR_API_KEY"):
        raise SystemExit("ERROR: LINEAR_API_KEY env var is required")

    issue_map = load_existing_map()  # {key: {id, identifier, title, url}}

    print(f"[info] fetching existing issues in project ...")
    existing = list_project_issues()
    print(f"[info] project has {len(existing)} issues")

    # Reconcile map with live state
    for spec in ISSUES:
        match = match_existing(existing, spec)
        if match:
            issue_map[spec["key"]] = match

    if dry_run:
        print("\n=== DRY RUN ===")
        for spec in ISSUES:
            status = "EXISTS" if spec["key"] in issue_map else "WILL CREATE"
            tail = f"→ {issue_map[spec['key']]['identifier']}" if spec["key"] in issue_map else ""
            print(f"  [{status:11}] {spec['key']:10} {spec['title']:80} {tail}")
        print("\n=== BLOCKED-BY EDGES ===")
        for spec in ISSUES:
            for b in spec["blockedBy"]:
                print(f"  {b} → blocks → {spec['key']}")
        print("\nTotal:", len(ISSUES), "issues")
        return

    # Create missing issues (preserve order)
    for spec in ISSUES:
        if spec["key"] in issue_map and not relations_only:
            print(f"[skip ] {spec['key']:10} already exists → {issue_map[spec['key']]['identifier']}")
            continue
        if relations_only:
            continue
        print(f"[create] {spec['key']:10} ...", flush=True)
        issue = create_issue(spec)
        issue_map[spec["key"]] = issue
        save_map(issue_map)
        print(f"         → {issue['identifier']}  {issue['url']}")
        time.sleep(0.3)  # gentle rate limiting

    # Create relations
    print("\n[info] creating blockedBy relations ...")
    for spec in ISSUES:
        if not spec["blockedBy"]:
            continue
        target = issue_map.get(spec["key"])
        if not target:
            print(f"[warn] no id for {spec['key']}, skipping its relations")
            continue
        rel = list_issue_relations(target["id"])
        existing_blockers = {n["issue"]["identifier"] for n in rel["inverseRelations"]["nodes"] if n["type"] == "blocks"}
        for b_key in spec["blockedBy"]:
            blocker = issue_map.get(b_key)
            if not blocker:
                print(f"[warn] {spec['key']} blockedBy {b_key} but no id for blocker, skipping")
                continue
            if blocker["identifier"] in existing_blockers:
                print(f"[skip ] {blocker['identifier']} → blocks → {target['identifier']} (already)")
                continue
            print(f"[rel  ] {blocker['identifier']} → blocks → {target['identifier']}")
            create_relation(blocker["id"], target["id"])
            time.sleep(0.2)

    save_map(issue_map)
    print(f"\n[done] map saved → {MAP_FILE}")
    print(f"[done] {len(issue_map)} issues tracked")


if __name__ == "__main__":
    main()
