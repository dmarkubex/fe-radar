# International Source Expansion Prep

This folder is a disabled-by-default preparation artifact for future source expansion. It does not enable sources, assign entity circles, or write to the database.

## Guardrails

- Every candidate keeps `enabledDefault: false`.
- Every candidate keeps `entityCircleAssignment: null`.
- `robotsStatus` is a required field and starts as `pending_manual_check` unless a human/operator records verification evidence.
- These candidates are not seed data. If any candidate is promoted later, use a reviewed migration or admin workflow with robots compliance evidence.

## Dry Run

```bash
pnpm tsx scripts/source-expansion-international-candidates.ts
pnpm tsx scripts/source-expansion-international-candidates.ts --json
```

Optional robots probing is read-only and does not modify this artifact:

```bash
pnpm tsx scripts/source-expansion-international-candidates.ts --check-robots --json
```
