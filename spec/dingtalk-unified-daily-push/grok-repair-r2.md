继续上一轮 `dingtalk-unified-daily-push`。独立 reviewer 在 `review-log.md` 追加 Round 2 required，`design.md` 已扩展允许文件边界。

仍由你（Grok CLI）实现，先读更新后的 design 与 review-log，然后修复：

1. targets API 的 GET/POST/PUT 响应不得返回完整 `webhookUrl` 或 `signSecret`。返回稳定的 `webhookUrlMasked`、`webhookConfigured`、`signSecretConfigured`（字段名可按现有风格微调但须一致）。mask 不得包含 access_token。
2. TargetTable 只显示 masked 值；TargetForm 编辑时 webhook 输入留空表示保持原值，创建时仍必须填写。PUT 仅在显式提供非空 webhook 时更新。不要削弱 admin 鉴权。
3. 增加真实 `POST /api/briefing/targets/[id]/test` route 单元测试：直接导入 route，覆盖 admin 鉴权、无内容 422、日报-only/简报-only/合并 ActionCard payload、签名/无签名 URL、钉钉错误且响应/日志无 webhook/secret。
4. 对齐 `dailyPushConfig.id` 的 Drizzle schema 与 0055 migration（优先移除无实际用途的 `.default(1)`，不要修改已写好的安全 seed）。

原 dirty worktree 和禁改清单继续有效。只改 design 新增允许路径和既有任务路径；spec 下只更新 review-log 实现记录。复跑全部原定向测试与新增 route 测试、ESLint、diff-check。不要 commit/push/deploy。
