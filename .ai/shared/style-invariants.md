# Style Invariants

These invariants prevent architectural drift when multiple agents or sub-agents work
in parallel. Every executing agent must read this file before writing code.

Violations found during code review are **major** severity by default.

---

## How To Use This File

This file ships as a near-empty template in the meta kernel. Each project should
customize it in `.ai/project-overrides.md` or directly in the project snapshot of
this file to reflect the actual project stack.

The invariants below are starter examples. **Delete or replace them** with your
project's real conventions during project bootstrap.

---

## 1. Naming Conventions

- files: `kebab-case` for source files, `PascalCase` for component/class files
- functions/methods: `camelCase`
- constants: `UPPER_SNAKE_CASE`
- database columns: `snake_case`
- API endpoints: `kebab-case` paths, `camelCase` JSON fields

## 2. Module Boundaries

- each domain module exposes functionality only through its public index/barrel file
- cross-module imports must go through the public API, never reach into internal files
- shared utilities live in a dedicated `shared/` or `common/` directory
- circular dependencies between modules are forbidden

## 3. Error Handling

- use a single, consistent error type or error class hierarchy per project
- never swallow errors silently — log or propagate
- API errors must return structured error responses with error codes
- do not invent new error code formats — follow the existing project convention

## 4. Testing Conventions

- test files live next to the source file or in a parallel `__tests__/` directory
  (pick one per project and stick with it)
- test names describe behavior, not implementation: `"returns 404 when user not found"`
- mocks and fixtures go in a shared test utilities directory, not duplicated per test

## 5. Dependency Rules

- do not add new runtime dependencies without explicit human approval
- prefer the existing library for a given concern (e.g., if the project uses `dayjs`,
  do not introduce `moment`)
- dev dependencies can be added freely for testing and tooling

## 6. Architecture Patterns

- follow the existing project's layering (e.g., controller → service → repository)
- do not introduce a new architectural pattern (e.g., event sourcing, CQRS) without
  explicit design approval
- keep business logic out of controllers/handlers — delegate to service layer

---

## Project Customization

Override or extend these invariants in the project snapshot. Common additions:

- framework-specific conventions (React hooks rules, Go interface naming, etc.)
- deployment and infrastructure constraints
- security-specific patterns (auth middleware placement, input sanitization, etc.)

When a project has no customized invariants yet, agents should infer conventions from
the existing codebase and propose additions to this file during retro.
