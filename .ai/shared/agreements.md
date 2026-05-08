# Shared Agreements

These are the default cross-project execution agreements for agents using this kernel.

## 1. Read Order

Before substantive work in a project repository, only the workflow entry agent should auto-run
the meta entrypoint when available:

`$AI_KERNEL_HOME/scripts/ensure-project.sh "$PWD"`

If `AI_KERNEL_HOME` is unset, fall back to:

`$HOME/Documents/AI_coding_format/scripts/ensure-project.sh "$PWD"`

Default workflow entry agent: `Claude Code`.

Other agents working in the same prepared project directory must not re-run sync by default.

Then read:

Always read:

1. project `AI_index.md`
2. project `.ai/shared/agreements.md`
3. project `handoff.md`
4. project `.ai/project-overrides.md` if present

Then read only the minimum task-relevant files.

In parallel Full Mode, `handoff.md` is the orchestrator summary. Sub-agents should write
task-local status into `.ai/handoff/<task-id>.md`, and Claude Code should merge the result.

## 2. Mode Selection

Default to Lite Mode.

Escalate to Standard Mode when:

- the change spans multiple modules but is low-to-medium risk
- multiple files are affected but a single agent can handle it
- formal plan review is not needed but code review is valuable

Escalate to Full Mode when:

- the task is high-risk or hard to reverse
- multiple agents need explicit ownership and parallel execution
- planning review is explicitly requested
- the change touches core systems, auth, payments, or data pipelines

## 2a. Lite Mode Restate Rule

In Lite Mode, the executing agent must produce a restate block before modifying code:

1. **Goal**: one-sentence summary of what the task achieves
2. **Plan**: which files will change and how
3. **Risks**: anything that could go wrong

Write this into `handoff.md` or present it for human confirmation. Do not skip even
for seemingly trivial changes. This prevents "放养" (unsupervised execution).

## 3. Agent Roles

| Agent | Responsibilities |
|-------|-----------------|
| Claude Code | project entry, mode selection, planning (requirements + design + tasks), sub-agent split strategy, plan-fix after review, stage transitions, release, retro |
| Codex | implementation via parallel sub-agents, code-fix after review |
| Antigravity | independent review at two gates: after plan, after code |

## 4. Planning Discipline

Do not require a six-file spec set by default.

Minimum planning set for Standard and Full Mode:

- `spec/requirements.md`
- `spec/design.md`
- `spec/tasks.md`

Create `api-contract`, `parallel-matrix`, and `ownership` only when they are genuinely needed.

Claude Code decides the sub-agent split strategy and records it in `spec/tasks.md`.

### Task Format

All tasks in `spec/tasks.md` must follow the template in `.ai/shared/task-template.md`.

Required fields per task: goal, constraints, ask_agent_first, owner, scope, rollback, acceptance.

Every task must have a concrete rollback plan. "No rollback needed" is not acceptable —
at minimum, write `revert commit`.

### Style Invariants

Before execution, agents must read `.ai/shared/style-invariants.md` (if present in the
project snapshot). This file defines code style, naming, and architectural constraints
that prevent drift across parallel sub-agents.

## 5. Review Gates

Two review gates, both owned by Antigravity:

| Gate | Trigger | Reviewer Input | Findings Go To |
|------|---------|---------------|----------------|
| Plan Review | Claude Code completes requirements + design + tasks | spec/*.md | Claude Code (fix plan) |
| Code Review | Codex completes implementation | changed files + spec/*.md | Codex (fix code) |

Critical findings trigger a fix-and-re-review loop.
Major and minor findings are fixed without re-review unless they form a systemic pattern.

## 6. Handoff Discipline

`handoff.md` is the project control token:

- current owner
- current state
- required human action, if any
- orchestrator queue
- context and risks

Do not use `handoff.md` as a global knowledge base.

When `Owner` is `Human`, AI agents must stop and wait for human input or validation.

## 7. Lessons Discipline

Write reusable lessons to the meta shared lessons immediately.

Write project-specific lessons to `.ai/project-lessons.md`.

Do not copy all project lessons into the shared lessons by default.

Project snapshots stay frozen unless intentionally refreshed, so new shared lessons do not
automatically alter in-flight projects.

### Lesson writeback paths

The project snapshot at `.ai/shared/lessons.md` is a frozen copy. Writing to it does NOT
update the meta kernel and will not be inherited by future projects.

Preferred: use the project-local helper:

```bash
.ai/scripts/promote-lesson.sh "lesson summary"
```

That resolves the source path from `.ai/meta-manifest.md`.

Low-level fallback: write directly to:

```
$AI_KERNEL_HOME/.ai/shared/lessons.md
```

or if `AI_KERNEL_HOME` is unset:

```
$HOME/Documents/AI_coding_format/.ai/shared/lessons.md
```

Writing to the project snapshot copy is acceptable for project-scoped lessons only.

## 8. Validation Discipline

Validation commands must match the actual project stack.

Never hardcode stack-specific checks such as `go test` unless the project is actually Go.

## 9. Stop Conditions

Stop and report when:

- project `AI_index.md` is missing
- project `.ai/shared/agreements.md` is missing
- required shared docs are missing
- a claimed hard gate contradicts the actual repository state

Warn but continue when:

- optional docs are missing
- the task is small enough for Lite Mode
