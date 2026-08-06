继续上一轮 `dingtalk-unified-daily-push` 实现。Codex 门 B Round 1 已在 `review-log.md` 给出 REQUEST_CHANGES，`design.md` 也已追加修订。

请先重新读取：

- `spec/dingtalk-unified-daily-push/design.md`
- `spec/dingtalk-unified-daily-push/review-log.md`
- `.ai/protocols/implementer.md`

由你（Grok CLI）修复 review-log 中全部 5 个 Major 和 1 个 Minor：

1. 用 `daily_pushes` 唯一键在发送前原子 INSERT pending claim，只有拿到 RETURNING 的 worker 可以发 webhook；发送后 UPDATE claim，补并发测试。
2. 修复共享 `dingtalk-bot.ts`：`signSecret` 为空时不得添加 timestamp/sign，非空时保持现有加签；补测试。
3. 新 minute repeat 注册前显式删除旧 `0 5 16 * * 1-5` repeat；bootstrap 与 scheduler-main 两条注册路径均覆盖，补测试。
4. `daily_pushes` 加入现有 cleanup 90 天事务清理与返回计数，补测试。
5. canonical stack 与当前 Portainer compose 的 worker/scheduler/web fail-fast 表清单加入 `public.daily_push_config,public.daily_pushes`。
6. 日报存在性按五个栏目实际非空判断，空 `{}` 不得记为 present。

仍须遵守原 dirty worktree/禁改清单。只可修改原 design 文件清单与本轮新增允许的 cleanup/dingtalk-bot 文件；spec 下只填写 review-log 实现记录，不得改 design/requirements/tasks/prompt。

完成后复跑原全部定向测试，加上 cleanup 与 dingtalk-bot 测试、目标文件 ESLint、`git diff --check`。不要 commit、push 或部署。最终仅报告修复项和验证结果。
