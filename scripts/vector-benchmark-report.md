# DMA-30 T-M2-09 Vector Index Benchmark Decision

## Scope

M2 requires a documented decision before hardening the pgvector index. The local
workspace cannot create the production 50K/500K Postgres benchmark dataset, so
this report records the selected default and the release-stage validation target.

## Decision

Use `ivfflat` with `lists = 200` in `packages/db/migrations/0005_pgvector_index.sql`.

## Rationale

- Lower build-time and memory risk than HNSW for the first internal deployment.
- Adequate for the M2 clustering path while the corpus is still below production
  scale.
- HNSW remains the M5 candidate once release smoke tests run on the build server.

## Acceptance Target For M5 Benchmark

| Dataset | Candidate | Recall@10 | P99 query latency |
|---|---|---:|---:|
| 50K | ivfflat lists=100/200 | >= 0.90 | <= 200ms |
| 50K | HNSW m=16 ef=64 | >= 0.90 | <= 200ms |
| 500K | ivfflat lists=100/200 | >= 0.90 | <= 200ms |
| 500K | HNSW m=16 ef=64 | >= 0.90 | <= 200ms |

If HNSW beats ivfflat on recall and P99 without unacceptable memory pressure,
M5 should add a follow-up migration that replaces the index.
