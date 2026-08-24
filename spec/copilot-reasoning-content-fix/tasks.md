# T-RC-01 Copilot reasoning_content 协议修复

```yaml
task: T-RC-01
  goal: "修复 DeepSeek 思考模式在多轮工具调用后因未回传 reasoning_content 而返回 400、导致 Copilot 无回答的问题。"
  constraints:
    - "公网 LLM 仍必须经过 worker /internal/llm 与 withScrubber。"
    - "不得持久化或向浏览器发送 reasoning_content；Copilot chatStream 使用 DeepSeek 原生 non-thinking 工具调用模式。"
    - "不新增依赖、类型、配置或抽象；不修改 Python、web、数据库、队列和既有压缩/看门狗语义。"
    - "保留当前工作树中与本任务无关的未提交改动。"
  ask_agent_first:
    - "复述 DeepSeek chatStream、worker SSE 与 AgentScope 工具调用的当前代码结构。"
    - "列出最小执行步骤。"
    - "列出协议回归、压缩回归和误影响 chatJson 的风险。"
    - "列出需要新增或更新的 TypeScript 测试。"
  owner: "Codex executor（agent-llm 范围）"
  scope:
    - "packages/llm/src/client.ts"
    - "packages/llm/src/__tests__/chatStream.test.ts"
  rollback: "revert 本任务单一 commit；生产 fe-radar-worker 与 fe-radar-copilot 两个镜像成对回滚到 7b55bec，Portainer Stack 89 原环境变量不变。"
  acceptance:
    - "chatStream 发给 DeepSeek 的请求显式包含 thinking.type=disabled。"
    - "chatJson 请求参数不增加 thinking 字段。"
    - "现有 token、tool call、压缩 tool_choice、timeout 与 abort 行为保持不变。"
    - "packages/llm 测试、worker 相关测试/typecheck、copilot pytest 全绿。"
    - "生产真实问答不再出现 reasoning_content must be passed back，返回 done，且无残留 turn_locked_at。"
```

# T-RC-02 Copilot 引用卡片 JSONB 写入修复

```yaml
task: T-RC-02
  goal: "修复有检索结果时 citations 字典列表无法写入 PostgreSQL jsonb、导致页面无模型回复的问题。"
  constraints:
    - "只在数据库写入边界使用 psycopg 原生 Jsonb；不改表、API、SSE、工具和前端。"
    - "保留 T-RC-01 non-thinking 修复及工作树其他未提交改动。"
    - "未知 turn 异常必须记录 correlationId 和 traceback，但不得记录用户问题或模型正文。"
  ask_agent_first:
    - "复述空 citations 成功、非空 dict list 失败的生产证据。"
    - "确认最小修改文件与回滚方式。"
    - "列出 Jsonb 参数形状和异常日志测试。"
  owner: "Codex executor（agent-copilot 范围）"
  scope:
    - "apps/copilot/memory/store.py"
    - "apps/copilot/chat.py"
    - "apps/copilot/tests/test_store.py"
  rollback: "revert 本任务单一 commit；生产 copilot 镜像回滚到 2982a06，worker 保持 2982a06。"
  acceptance:
    - "非空 citations 以 psycopg Jsonb 参数写入，内容不变。"
    - "未知异常日志包含 correlationId 与 traceback，不包含用户/模型正文。"
    - "Copilot 全量测试通过。"
    - "生产条目会话返回 token/citation/done，assistant 消息落库、audit aborted=false、turn_locked_at 清零。"
```
