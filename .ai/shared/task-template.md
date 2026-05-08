# Task Template

Use this template for each task entry in `spec/tasks.md`. All fields are required
unless marked optional.

## Template

```yaml
task: <task-id>
  goal: "<one sentence: what this task achieves>"
  constraints:
    - "<boundary or restriction>"
    - "<boundary or restriction>"
  ask_agent_first:
    - "restate understanding of current code structure"
    - "outline execution steps"
    - "list risk points"
    - "list tests to add or update"
  owner: "<agent or sub-agent id>"
  scope:
    - "<file or module this task is allowed to modify>"
  rollback: "<how to undo this change if it fails — e.g., revert PR, disable feature flag, run migration rollback>"
  acceptance:
    - "<observable condition that proves success>"
    - "<observable condition that proves success>"
```

## Field Descriptions

### goal
One sentence describing the user-visible or system-visible outcome. Not an
implementation step — a result.

### constraints
Boundaries the agent must not cross. Examples: "do not change existing API fields",
"no new dependencies", "only modify billing module". Keep it under 10 items.

### ask_agent_first
Before writing any code, the agent must answer these questions and present the
answers for review. This is the "先复述再执行" discipline. Customize per task,
but the four defaults above are the minimum.

### owner
The agent or sub-agent responsible. In parallel Full Mode, this determines which
sub-agent picks up the task.

### scope
Explicit list of files, directories, or modules this task is allowed to touch.
Sub-agents must not modify files outside their scope.

### rollback
A concrete, executable rollback plan. Every task must have one. Examples:
- `revert PR #123`
- `revert PR + disable feature flag billing_retry`
- `run migration rollback: rails db:rollback STEP=1`
- `restore from backup + redeploy previous tag`

If the task is truly non-destructive (e.g., adding a log line), write
`revert commit` as the minimum.

### acceptance
Observable, testable conditions that prove the task is done correctly. These
should be checkable by the reviewer or by automated tests.

## Usage Rules

1. Claude Code produces tasks in this format when writing `spec/tasks.md`
2. Codex sub-agents must read and follow the template fields
3. Antigravity checks that all fields are present and coherent during Plan Review
4. In Lite Mode, use a simplified inline version (goal + constraints + rollback)
   in `handoff.md` instead of the full template
