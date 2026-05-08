# AI Index — Meta Kernel

> This repository is the canonical source of the AI coding kernel on this machine.
> Project repos should snapshot the kernel rules from here at workflow entry, then run
> against the project-local copy so in-flight projects are isolated from later kernel changes.

---

## 1. Source Of Truth

### Meta Layer (machine-level, shared)

Default root resolution order:

1. `$AI_KERNEL_HOME`
2. `$HOME/Documents/AI_coding_format`

The meta layer contains stable cross-project rules:

- `AI_index.md`
- `.ai/shared/agreements.md`
- `.ai/shared/review-protocol.md`
- `.ai/shared/lessons.md`
- `.ai/shared/task-template.md`
- `.ai/shared/style-invariants.md`
- `.ai/roles/claudecode.md`
- `.ai/roles/codex.md`
- `.ai/roles/Antigravity.md`
- `scripts/*.sh`

### Project Layer (repo-local, snapshot + state)

Each project should only keep:

- `AI_index.md` — snapshot of the kernel entry for this project
- `.ai/shared/*` — snapshot of shared rules for this project
- `.ai/roles/*` — snapshot of role definitions for this project
- `handoff.md` — current project session state
- `.ai/project-overrides.md` — project-specific rules
- `.ai/project-lessons.md` — project-only learnings
- `spec/*` and `.understanding/*` only when the current task actually needs them

Rule priority:

1. User/system/developer instructions
2. Project-local overrides
3. Project snapshot rules

---

## 2. Agents

Three agents, clear ownership:

| Agent | Role | Tool |
|-------|------|------|
| Claude Code | Coordinator + Planner + Plan-Fix | Anthropic Claude Code CLI |
| Codex | Parallel Executor + Code-Fix | OpenAI Codex with sub-agents |
| Antigravity | Independent Reviewer | Google |

Claude Code is the workflow entry agent and owns project preparation, planning, and stage transitions.

---

## 3. Operating Modes

### Lite Mode

Use for:

- analysis
- small fixes
- one-file or low-risk edits
- tasks that do not need parallel ownership or formal planning review

Required inputs:

- project `AI_index.md`
- project `.ai/shared/agreements.md`
- project `handoff.md`
- only the minimum task-relevant files

Before modifying any code, the executing agent must write a brief restate block into
`handoff.md` (or output it for human confirmation) covering:

1. **Goal**: what the task aims to achieve (one sentence)
2. **Plan**: what files will be changed and how (bullet list)
3. **Risks**: anything that could go wrong or needs extra attention

The human may correct the restate before allowing execution. Do not skip this step
even for seemingly trivial changes.

Recommended outputs:

- update `handoff.md`
- optionally update `.ai/project-lessons.md`

### Standard Mode

Use for:

- cross-module changes that are low-to-medium risk
- multi-file edits handled by a single agent (no parallel sub-agents needed)
- tasks where code review is valuable but formal plan review is overkill

Required inputs:

- everything from Lite Mode
- `spec/tasks.md` (using the task template format from `.ai/shared/task-template.md`)

Optional, only when needed:

- `spec/requirements.md` (if the task scope is ambiguous)
- `spec/design.md` (if architectural decisions are involved)

Key difference from Full Mode: skips Antigravity Plan Review. Code review still applies.

### Full Mode

Use for:

- multi-agent parallel work
- high-risk refactors or changes to core systems (auth, payments, data pipelines)
- tasks with explicit planning/review gates
- strong-audit scenarios (金融、医疗、政企)

Required inputs:

- everything from Lite Mode
- `.understanding/*` for existing projects when repository context is not yet clear
- `spec/requirements.md`
- `spec/design.md`
- `spec/tasks.md` (using the task template format from `.ai/shared/task-template.md`)

Optional, only when needed:

- `spec/api-contract.md`
- `spec/parallel-matrix.md`
- `spec/ownership.md`

Do not generate the full spec set by default. Generate only the files needed by the task.

---

## 4. Stage Model

### Lite Mode stages

`Plan (guard + restate) -> Execute -> Review -> Close`

Plan includes the guard checklist (section 5) as its first step, followed by the
mandatory restate block (Goal / Plan / Risks) before any code changes.

### Standard Mode stages

`Plan (guard + restate + tasks) -> Execute -> Review Code -> Fix Code -> Close`

Standard Mode produces `spec/tasks.md` during Plan but skips the Antigravity Plan Review
gate. Code review by Antigravity still applies after execution.

### Full Mode stages

`Plan -> Review Plan -> Fix Plan -> Execute -> Review Code -> Fix Code -> Release -> Retro`

Stage details:

| Stage | Owner | Description |
|-------|-------|-------------|
| Plan | Claude Code | guard checklist + requirements + design + tasks + sub-agent split strategy |
| Review Plan | Antigravity | review requirements + design together; actionable findings with severity |
| Fix Plan | Claude Code | fix planning artifacts; re-submit to Antigravity if critical findings exist |
| Execute | Codex | parallel implementation via sub-agents per task plan |
| Review Code | Antigravity | review implementation for correctness, regression, test adequacy |
| Fix Code | Codex | fix code findings; re-run tests |
| Release | Claude Code | validate, merge |
| Retro | Claude Code | lessons learned, promote to shared kernel if reusable |

Fix Plan and Fix Code are conditional — skip them when review passes clean.

Do not split into more stages unless the task materially benefits from the split.

### CLAUDE.md Update via /init

In Standard and Full Mode, after producing spec artifacts and before review/execution,
Claude Code should run `/init` to update `CLAUDE.md` with project-specific context
(tech stack, directory structure, module boundaries, key constraints).

Timing:

- **Full Mode**: after Plan (step 2), before Review Plan (step 3)
- **Standard Mode**: after task split (step S2), before execution (step S3)
- **Lite Mode**: not required (scope is too small to benefit)

Rules:

- `/init` must preserve the existing `# BEGIN AI_KERNEL` block in `CLAUDE.md`
- Skip if `CLAUDE.md` already contains sufficient project context (not first run)
- The updated `CLAUDE.md` serves as the project entry guide for downstream agents
  (Codex sub-agents, Antigravity)

---

## 5. Guard Checklist

Run as the first step of the Plan stage. Stop only on hard blockers.

### Hard blockers

- `AI_index.md` or `.ai/shared/agreements.md` is missing from the project
- project has unresolved merge conflicts

### Warnings, not blockers

- project is not on a feature branch
- `.understanding/*` is missing for an existing project
- `spec/*` is missing for a task that probably needs Full Mode

Suggested checks:

```bash
git branch --show-current 2>/dev/null || true
git status --short 2>/dev/null || true
test -f "AI_index.md" || echo "HARD BLOCKER: AI_index.md missing"
test -f ".ai/shared/agreements.md" || echo "HARD BLOCKER: agreements.md missing"
```

---

## 6. Progressive Disclosure

Read in this order:

1. Project `AI_index.md`
2. Project `.ai/shared/agreements.md`
3. Project `handoff.md`
4. Project `.ai/project-overrides.md` if present
5. Only the files needed for the current stage

Read `spec/*` and `.understanding/*` on demand. Do not front-load repository context.

### Parallel Full Mode

In parallel work, `handoff.md` is the orchestrator summary only.

Sub-agents must write task-local status into:

- `.ai/handoff/<task-id>.md`

Claude Code is responsible for merging task progress back into `handoff.md`.

---

## 7. Lessons Policy

### Write to `.ai/shared/lessons.md` when a lesson is:

- reusable across multiple projects
- about agent behavior, review discipline, workflow, or common engineering failure modes

### Write to `.ai/project-lessons.md` when a lesson is:

- specific to one codebase, stack, org, or domain
- unlikely to help unrelated projects

### Promotion rule

If a project-local lesson repeats in multiple repos, promote it into the shared meta lessons.

Do not wait until a project ends. Write reusable lessons into the meta layer as they are discovered.

### Writeback path

The project snapshot `.ai/shared/lessons.md` is frozen. Writing to it does not update the meta kernel.

Preferred: use the project-local helper:

```bash
.ai/scripts/promote-lesson.sh "lesson summary"
```

That resolves the meta kernel source path from `.ai/meta-manifest.md` and appends a draft
promotion to the meta shared lessons.

Low-level fallback: write directly to the meta kernel:

```
$AI_KERNEL_HOME/.ai/shared/lessons.md
```

or if unset: `$HOME/Documents/AI_coding_format/.ai/shared/lessons.md`

---

## 8. Snapshot Upgrade Model

Project repos should be prepared from this meta repo once, at workflow entry.

Default owner: `Claude Code`

Default entrypoint:

```bash
scripts/ensure-project.sh /path/to/project
```

Behavior:

- no project snapshot manifest -> bootstrap once
- existing project snapshot manifest -> no-op
- explicit upgrade or patch -> manual `sync-meta.sh`
- run once at project/session entry
- downstream agents (`Codex`, `Antigravity`) reuse the same project directory and must not repeat sync unless explicitly asked

Manual commands remain available when needed:

```bash
scripts/bootstrap-project.sh /path/to/project
scripts/sync-meta.sh /path/to/project
```

The project snapshot is the runtime copy. This meta repo remains the source for new projects
and explicit upgrades.

## 9. Handoff State Machine

`handoff.md` is not a narrative changelog. It is the project control token.

It must answer:

- who owns the next move
- whether AI should continue or stop
- whether human validation is required before more AI work

Required sections:

- `Current Control`
- `Human Action Required`
- `Orchestrator Queue`
- `Context & Risks`

When ownership is `Human`, downstream agents must stop and wait for the requested validation
or decision before proceeding.

## 10. VCS Strategy

Recommended default: commit the project kernel snapshot so that a historical checkout keeps
the exact rules it ran with.

Commit:

- `AI_index.md`
- `.ai/shared/*`
- `.ai/roles/*`
- `.ai/scripts/*`
- `.ai/project-overrides.md`
- `.ai/project-lessons.md`
- `.ai/meta-manifest.md`

Ignore as volatile runtime state:

- `handoff.md`
- `.ai/handoff/*`

For the exact sync model and writeback rules, see [META_SYNC.md](META_SYNC.md).
