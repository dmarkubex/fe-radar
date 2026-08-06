你是本任务唯一代码实现器。工作目录是 `/Volumes/SD/AI-Timeline-web`。

先完整阅读并严格遵守：

1. 根目录 `AGENTS.md`
2. `.ai/protocols/implementer.md`
3. `spec/dingtalk-unified-daily-push/requirements.md`
4. `spec/dingtalk-unified-daily-push/design.md`
5. `spec/dingtalk-unified-daily-push/tasks.md`
6. `spec/dingtalk-unified-daily-push/review-log.md`

执行 T-DUP-01、T-DUP-02、T-DUP-03，完成代码与测试，但不要 commit、push 或部署。

硬边界：

- 当前是混合 dirty worktree。开始前先运行 `git status --short`，不得覆盖、格式化或回退不属于本任务的改动。
- 只能修改 design.md“文件清单”中的文件；spec 下只允许填写 `review-log.md` 的“实现记录”，不得改 requirements/design/tasks/grok-prompt。
- 禁止修改 migration 0054 及任何既有 migration；新 migration 必须是 0055。
- 禁止修改 alerts、timeline、websearch、NER、scoring 与 auth/middleware 文件。
- 不新增依赖，不输出或读取生产 webhook、sign secret、AppSecret。
- 遇到设计缺口或文件边界不足时停止，并在 review-log 记录，不得擅自扩范围。

完工要求：

- 按 design 验证命令运行定向测试、目标文件 lint、`git diff --check`。
- 全量 typecheck 若只被既有 `apps/web/lib/api/alerts-query.ts:62` 阻断，记录证据但不要修它。
- 在 review-log 的实现记录填写实际改动文件、自检结果、偏离和缺口。
- 最终回复仅说明实现状态、改动文件、测试结果和任何阻塞。
