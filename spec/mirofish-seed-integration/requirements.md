# FE-Radar x MiroFish Seed Integration Requirements

Version: v0.1
Date: 2026-06-29
Owner: Codex
Status: Implementation-ready

## Goal

Allow an editor/admin to open a FE-Radar item detail, click "模拟预测", create a MiroFish project from the item's normalized intelligence context, and jump to that MiroFish project without forcing the user to manually upload a file.

## Scope

- FE-Radar generates a seed package from the current item, scores, entities, summary, source metadata, and related cluster items.
- FE-Radar calls MiroFish through a server-side integration endpoint.
- MiroFish accepts a JSON seed payload and creates the same project state currently produced by file upload: saved seed file, extracted text, generated ontology, analysis summary, and `ontology_generated` status.
- The existing MiroFish multipart file-upload flow remains available.

## Out Of Scope

- Automatic graph build, simulation run, or report generation after project creation.
- MiroFish crawling arbitrary source URLs.
- New FE-Radar database tables.
- SSO/token handshake between the products.
- Concrete commodity price prediction, trading advice, or investment recommendation.

## Functional Requirements

### FR-MF-01 Detail-page action

FE-Radar item detail views must expose a "模拟预测" action only to `editor` and `admin` roles.

### FR-MF-02 Normalized seed package

FE-Radar must package item context as normalized text plus metadata:

- item id, title, source name/tier/category/fetcher type
- source URL/display URL
- published/scored time
- five-dimension scores and alert fields
- summary, translation, parsed content
- recognized entities
- related cluster items
- simulation requirement

### FR-MF-03 JSON seed API

MiroFish must provide a JSON endpoint for trusted upstream systems:

`POST /api/external/seed`

The endpoint must accept at least one inline text document and a simulation requirement. It must not require multipart upload.

### FR-MF-04 Project creation parity

The JSON seed endpoint must create a MiroFish project equivalent to upload-based ontology generation:

- project metadata is saved
- seed document is persisted under project files
- extracted text is saved
- ontology generation runs
- project status becomes `ontology_generated`
- response includes `project_id`

### FR-MF-05 Server-side integration

FE-Radar must call MiroFish from its API route, not directly from the browser. The browser receives only the created `projectId` and `projectUrl`.

### FR-MF-06 Failure behavior

FE-Radar must map missing MiroFish configuration to `503`, and MiroFish project creation failures to `502`.

## Non-functional Requirements

### NFR-MF-01 Compliance boundary

FE-Radar remains the source-parsing authority. MiroFish receives normalized text and metadata only. MiroFish must not fetch or persist raw webpage HTML for this flow.

### NFR-MF-02 Existing FE-Radar constraints

The integration must preserve FE-Radar constraints:

- no raw HTML snapshot storage
- no public LLM call outside the established FE-Radar processing path
- no user phone number handling
- editor/admin-only action

### NFR-MF-03 MiroFish compatibility

The existing `/api/graph/ontology/generate` multipart endpoint must keep its current contract.

### NFR-MF-04 Payload guardrails

MiroFish must reject empty seed documents and bound the number/size of inline documents to avoid accidental large requests.

### NFR-MF-05 Deployment boundary

The two services do not have to live in the same Docker Compose file. Production may connect them through a shared internal Docker/Swarm network or a reverse-proxied internal URL configured by:

- `MIROFISH_API_BASE_URL`
- `MIROFISH_WEB_BASE_URL`
- `MIROFISH_REQUEST_TIMEOUT_MS`

## Acceptance

- FE-Radar posts JSON to `/api/external/seed`, not multipart file upload.
- MiroFish accepts a JSON seed payload and returns a usable `project_id`.
- Existing MiroFish upload route is not broken.
- Unit tests cover FE-Radar seed packaging/call shape and MiroFish JSON validation/project creation.
