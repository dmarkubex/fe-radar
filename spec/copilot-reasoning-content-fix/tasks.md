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
