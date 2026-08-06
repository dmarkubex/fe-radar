# 钉钉合并日报推送实施任务

状态：Execute · Owner = Grok CLI

日期：2026-08-06

## T-DUP-01 数据与共享卡片

- status: **completed**
- goal: 增加数据库调度/审计模型与可由 worker/web 复用的纯卡片构造器。
- constraints: migration 固定 0055；配置 seed `ON CONFLICT DO NOTHING`；不新增依赖；不触碰 0054。
- ask_agent_first: 先读 `schema-commodity.ts`、migration runner、日报 sections 和现有 ActionCard 类型。
- owner: Grok CLI
- scope: design 文件清单中的 db/core 文件。
- rollback: 回退代码并按 0055 注释 rollback 删除两张新表。
- acceptance: migration/schema 对齐；卡片四种数据组合、URL、截断和非法 baseUrl 测试通过。

## T-DUP-02 Worker 调度与推送

- status: **completed**
- goal: 以每分钟 tick + DB 配置实现合并日报定时发送、幂等与审计。
- constraints: 保留正数 briefingId 手工重推；移除生成后单独自动推送；不打印凭据。
- ask_agent_first: 先读 queue 的两个注册入口、现有 `briefing-push.ts` 和 `briefing-gen.ts` 的入队测试。
- owner: Grok CLI
- scope: design 文件清单中的 worker 文件。
- rollback: 恢复原 16:05 repeat 和原 briefing push 消费逻辑；停用配置。
- acceptance: disabled/未到时/周末或节假日/无目标/无内容/四种内容组合/重复 tick/单目标失败均有测试。

## T-DUP-03 后台配置与真实测试卡片

- status: **completed**
- goal: 管理员可配置调度并向单个目标发送含真实深链的测试 ActionCard。
- constraints: admin only；secret 保持 mask；baseUrl 信任边界校验；不修改认证。
- ask_agent_first: 先读现有 targets API/UI、authz 和测试推送路由，复用页面。
- owner: Grok CLI
- scope: design 文件清单中的 web/deploy 文件。
- rollback: 移除 schedule API/UI，恢复纯文本测试推送。
- acceptance: API 鉴权/校验、UI 保存错误态、无目标提示、真实 ActionCard payload 均有测试。

## T-DUP-04 独立评审、生产部署与真机验收

- status: **needs_human_review**
- goal: Codex 独立审查 Grok diff，修复 Critical/Major 后部署 migrate/worker/web 并发送真实验收卡片。
- constraints: 精确暂存，不带入当前混合工作区其他改动；不得复用 Grafana webhook；必须由管理员录入日报群机器人目标。
- ask_agent_first: Grok 完成后由 Codex 对照 design 逐文件评审和实跑验证。
- owner: Codex
- scope: review、定向修复、Portainer 构建部署与生产证据。
- rollback: 恢复部署前 migrate/worker/web digest，配置置 disabled。
- acceptance: migration ledger 成功、三服务使用新镜像、配置可见、测试卡片送达、钉钉内点击免扫码进入日报/简报。
