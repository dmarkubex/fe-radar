# Review Protocol

Use this protocol for both plan review and code review. Antigravity owns both gates.

## 1. Review Gates

### Gate 1: Plan Review

Triggered when Claude Code completes requirements + design + tasks.

Review scope:

1. requirements clarity, testability, and completeness
2. design consistency with requirements — no over-engineering, no gaps
3. task coverage — does the task plan cover the full design surface area?
4. sub-agent split strategy — are ownership boundaries clear and conflict-free?
5. parallel safety — can sub-agents work independently without file-level conflicts?

### Gate 2: Code Review

Triggered when Codex completes implementation.

Review scope:

1. design conformance — does the code match the approved design?
2. behavioral correctness and edge case coverage
3. regression risk assessment
4. test adequacy — do tests match the changed surface area?
5. parallel merge safety — cross-boundary violations or silent conflict resolutions?

## 2. What To Check In Lite Mode

- is the task scoped correctly
- was the restate block (Goal / Plan / Risks) produced before execution
- was the minimum context read
- does the change solve the requested problem
- are the risks and verification steps explicit

## 2a. What To Check In Standard Mode

Standard Mode skips the Plan Review gate but keeps Code Review. During Code Review:

- everything from Lite Mode checks
- do tasks in `spec/tasks.md` follow the template format (`.ai/shared/task-template.md`)
- is the rollback plan for each task concrete and executable
- are acceptance criteria met
- does the code respect `.ai/shared/style-invariants.md` conventions

## 3. Review Output Shape

For each finding:

- **Finding**: what is wrong or risky
- **Severity**: critical / major / minor
- **Why it matters**: concrete impact if not addressed
- **Required fix or follow-up**: specific, actionable instruction

## 4. Severity And Re-Review Rules

| Severity | Fix required? | Re-review required? |
|----------|--------------|-------------------|
| Critical | Yes | Yes — must pass re-review before proceeding |
| Major | Yes | No — unless multiple major findings form a systemic pattern |
| Minor | Yes | No |

## 5. Feedback Routing

| Gate | Findings go to | Fix owner |
|------|---------------|-----------|
| Plan Review | Claude Code | Claude Code fixes planning artifacts |
| Code Review | Codex | Codex fixes code and re-runs tests |

## 6. Lesson Trigger

Promote a new shared lesson when the same category of mistake is likely to recur across projects.
