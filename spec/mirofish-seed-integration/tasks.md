# FE-Radar x MiroFish Seed Integration Tasks

Version: v0.1
Date: 2026-06-29
Mode: Standard
Owner: Codex

## T-MF-01 Spec and contract

Goal: Define the FE-Radar to MiroFish handoff contract before implementation.

Constraints:

- Keep scope to create-project-and-jump.
- Do not introduce graph build or simulation auto-run.
- Do not make MiroFish crawl arbitrary URLs.

Ask agent first:

- Confirm current FE-Radar item detail DTO fields.
- Confirm current MiroFish project creation/upload flow.

Owner: Codex

Scope:

- `spec/mirofish-seed-integration/requirements.md`
- `spec/mirofish-seed-integration/design.md`
- `spec/mirofish-seed-integration/tasks.md`

Rollback:

- Delete `spec/mirofish-seed-integration/`.

Acceptance:

- Requirements, design, and tasks explicitly state JSON seed API, role gating, deployment boundary, and no raw HTML/URL crawling.

## T-MF-02 MiroFish JSON seed API

Goal: Add a MiroFish endpoint that creates a project from inline text documents.

Constraints:

- Preserve `/api/graph/ontology/generate`.
- Reuse current `ProjectManager`, `TextProcessor`, and `OntologyGenerator`.
- Bound document count and total text size.

Ask agent first:

- Check blueprint registration pattern.
- Check project file persistence format.

Owner: Codex

Scope:

- `/Volumes/SD/MiroFish/backend/app/api/__init__.py`
- `/Volumes/SD/MiroFish/backend/app/__init__.py`
- `/Volumes/SD/MiroFish/backend/app/api/external.py`
- `/Volumes/SD/MiroFish/backend/app/models/project.py`
- `/Volumes/SD/MiroFish/backend/tests/test_external_seed_api.py`

Rollback:

- Remove the new blueprint/test and revert `ProjectManager` additions.

Acceptance:

- `POST /api/external/seed` validates JSON and creates an `ontology_generated` project with saved text files.
- Tests cover success and validation failure without calling a real LLM.

## T-MF-03 FE-Radar JSON integration

Goal: Switch FE-Radar server-side MiroFish integration from multipart upload to JSON seed payload.

Constraints:

- Keep browser route contract stable.
- Keep editor/admin gating.
- Keep deployment env variables.
- Do not store raw HTML.

Ask agent first:

- Confirm `ItemDetailDto` fields are sufficient.
- Confirm existing button locations in dialog and standalone detail page.

Owner: Codex

Scope:

- `apps/web/lib/api/mirofish.ts`
- `apps/web/lib/api/__tests__/mirofish.test.ts`
- existing `/api/items/:id/mirofish` route and UI only if contract changes require it

Rollback:

- Revert `apps/web/lib/api/mirofish.ts` to multipart upload behavior.

Acceptance:

- FE-Radar posts JSON to `/api/external/seed`.
- Tests assert request URL/body shape and returned project URL.

## T-MF-04 Verification

Goal: Verify both repositories after implementation.

Constraints:

- Do not consume real MiroFish LLM/Zep calls unless explicitly needed.
- Keep unrelated dirty worktree files untouched.

Ask agent first:

- Identify targeted FE-Radar tests.
- Identify MiroFish pytest entrypoint.

Owner: Codex

Scope:

- FE-Radar targeted unit tests and typecheck.
- MiroFish targeted pytest.
- `git diff --check` in FE-Radar.

Rollback:

- Revert implementation files listed in T-MF-02/T-MF-03 if verification shows blocking regressions.

Acceptance:

- Targeted tests pass.
- FE-Radar typecheck passes.
- Whitespace check passes.
