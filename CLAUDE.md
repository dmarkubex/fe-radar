# BEGIN AI_KERNEL

## AI Workflow Kernel

This project uses the AI coding kernel. Before starting any substantive work, read these files in order:

1. `AI_index.md` — project snapshot of the kernel rules
2. `.ai/shared/agreements.md` — cross-project execution agreements
3. `handoff.md` — current project control state
4. `.ai/project-overrides.md` — project-specific rules (if present)
5. `.ai/shared/style-invariants.md` — code style and architecture invariants
6. `.ai/shared/task-template.md` — standard task format for spec/tasks.md

### Agents

| Agent | Role |
|-------|------|
| Claude Code | Coordinator + Planner + Plan-Fix (you) |
| Codex | Parallel Executor + Code-Fix |
| Antigravity | Independent Reviewer (Google) |

### Three Operating Modes

| Mode | When | Stages |
|------|------|--------|
| Lite | small fixes, single file, low risk | Plan(guard+restate) → Execute → Review → Close |
| Standard | cross-module, low-medium risk, single agent | Plan(guard+restate+tasks) → Execute → Code Review → Fix → Close |
| Full | high risk, multi-agent parallel, core systems | Plan → Review Plan → Fix Plan → Execute → Review Code → Fix Code → Release → Retro |

Default to Lite. Escalate based on risk and scope.

### Key Rules

- In Lite Mode, produce a restate block (Goal / Plan / Risks) before any code change.
- In Standard and Full Mode, all tasks in `spec/tasks.md` must use the template format (goal, constraints, ask_agent_first, owner, scope, rollback, acceptance).
- After producing spec, run `/init` to update CLAUDE.md with project context (first time or when context is stale).
- After planning, hand off to Antigravity for review (Full Mode only). Fix critical findings before proceeding.
- Delegate implementation to Codex for parallel execution. After code review by Antigravity, Codex fixes findings.
- Maintain `handoff.md` as the control token. When Owner is Human, stop and wait.
- Read `.ai/shared/style-invariants.md` before writing code to prevent architectural drift.
- Every task must have a concrete rollback plan.
- Write reusable lessons to `.ai/shared/lessons.md` via `.ai/scripts/promote-lesson.sh`.

# END AI_KERNEL
