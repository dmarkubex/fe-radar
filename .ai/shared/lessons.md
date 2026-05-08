# Shared Lessons

These lessons are reusable across projects and should be read before significant work.

Do not dump every project retrospective here. Only keep lessons that are broadly reusable.

## Promotion Criteria

Promote here when the lesson is about:

- workflow discipline
- review discipline
- recurring engineering failure modes
- common release or debugging mistakes

Keep project-only lessons in `.ai/project-lessons.md`.

## How To Write A New Lesson

Use this template to draft a lesson, then paste it under `## Current Lessons`:

```
### YYYY-MM-DD - [title]

Issue: [brief issue]

Root cause: [root cause]

Fix: [what changed]

Prevention rule: [short reusable rule]
```

If you are promoting a lesson from a project snapshot, prefer `.ai/scripts/promote-lesson.sh`
inside that project so the kernel source path is resolved from `.ai/meta-manifest.md`.

## Current Lessons

### 2026-04-17 - Async write followed by stale cache refresh

Issue: async DB work and cache refresh were split across execution paths, leaving stale cache.

Root cause: cache refresh did not happen in the same async flow that completed the DB write.

Fix: perform DB completion and cache refresh sequentially in the same async execution path.

Prevention rule: after async state mutation, complete the corresponding cache refresh in the same execution path before considering the operation done.
