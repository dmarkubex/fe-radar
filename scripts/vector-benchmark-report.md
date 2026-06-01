# KYO-105 / KYO-110 Vector Benchmark Report

## Environment

| Item             | Value                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| Machine          | Apple M4 Pro, 24 GB RAM                                                                             |
| OS               | macOS 26.5 (Build 25F71)                                                                            |
| Node             | v25.9.0                                                                                             |
| tsx              | v4.21.0                                                                                             |
| pnpm             | 11.0.9                                                                                              |
| Docker           | 28.4.0                                                                                              |
| pgvector image   | pgvector/pgvector:pg16                                                                              |
| Dataset          | Deterministic synthetic, seed 54001, 1024 dimensions                                                |
| Datasets on disk | `generated/embedding/vectors-50k.jsonl` (941 MB), `generated/embedding/vectors-500k.jsonl` (9.2 GB) |

## Commands

```bash
# Brute-force (KYO-105)
VECTOR_BENCH_ROWS=50000 VECTOR_BENCH_DIMENSIONS=1024 VECTOR_BENCH_QUERIES=200 \
  pnpm exec tsx scripts/vector-benchmark.ts

VECTOR_BENCH_ROWS=500000 VECTOR_BENCH_DIMENSIONS=1024 VECTOR_BENCH_QUERIES=200 \
  pnpm exec tsx scripts/vector-benchmark.ts

# pgvector indexed (KYO-110)
docker run -d --name fe-radar-pgvector -p 5433:5432 \
  -e POSTGRES_PASSWORD=postgres pgvector/pgvector:pg16

# Load data + create ivfflat index + run benchmark
VECTOR_BENCH_MODE=pgvector VECTOR_BENCH_ROWS=500000 VECTOR_BENCH_DIMENSIONS=1024 \
  VECTOR_BENCH_INDEX_TYPE=ivfflat \
  pnpm exec tsx scripts/vector-benchmark.ts
```

## Results

### 50K rows — brute-force (KYO-105 baseline)

| Metric      | Value                                  |
| ----------- | -------------------------------------- |
| Rows        | 50,000                                 |
| Dimensions  | 1,024                                  |
| Queries     | 200                                    |
| top-K       | 10                                     |
| Index type  | brute-force-cosine (no pgvector index) |
| Recall@10   | **1.0000** (brute-force is exact)      |
| Latency P50 | 48.36 ms                               |
| Latency P95 | 53.21 ms                               |
| Latency P99 | **54.97 ms**                           |
| Latency min | 46.70 ms                               |
| Latency max | 58.79 ms                               |

**M2 gate (50K brute-force): recall@10 ≥ 0.9 ✅ | P99 ≤ 200 ms ✅**

### 500K rows — brute-force (KYO-105 baseline, no index)

| Metric      | Value                                  |
| ----------- | -------------------------------------- |
| Rows        | 500,000                                |
| Dimensions  | 1,024                                  |
| Queries     | 200                                    |
| top-K       | 10                                     |
| Index type  | brute-force-cosine (no pgvector index) |
| Recall@10   | **1.0000** (brute-force is exact)      |
| Latency P50 | 564.20 ms                              |
| Latency P95 | 592.20 ms                              |
| Latency P99 | **604.98 ms**                          |
| Latency min | 519.22 ms                              |
| Latency max | 949.35 ms                              |

**M2 gate (500K brute-force): recall@10 ≥ 0.9 ✅ | P99 ≤ 200 ms ❌ (604.98 ms)**

### 500K rows — pgvector ivfflat (KYO-110)

| Metric       | Value                                       |
| ------------ | ------------------------------------------- |
| Rows         | 500,000                                     |
| Dimensions   | 1,024                                       |
| Queries      | 200                                         |
| top-K        | 10                                          |
| Index type   | pgvector-ivfflat                            |
| Index params | lists=200, probes=10                        |
| Recall@10    | **0.9980** (vs brute-force sequential scan) |
| Latency P50  | 73.45 ms                                    |
| Latency P95  | 92.95 ms                                    |
| Latency P99  | **98.83 ms**                                |
| Latency min  | 49.72 ms                                    |
| Latency max  | 104.47 ms                                   |

**M2 gate (500K ivfflat): recall@10 ≥ 0.9 ✅ | P99 ≤ 200 ms ✅**

Recall measured by comparing ivfflat top-10 results against brute-force sequential scan ground truth for the same 200 query vectors.

## Analysis

1. **50K passes M2 gate without an index.** P99 = 54.97 ms, well under the 200 ms budget. Brute-force cosine at this scale is fast enough on M4 Pro.

2. **500K exceeds P99 budget without an index.** Brute-force P99 = 604.98 ms (~3× over budget). O(n·d) scaling with 10× more rows confirms that an approximate index is mandatory at production scale.

3. **500K ivfflat (lists=200, probes=10) passes both M2 gates.** P99 drops from 604.98 ms → 98.83 ms (6.1× speedup) while maintaining recall@10 = 0.998. The approximate index trades < 0.2% recall for a 6× latency improvement.

4. **Parameter selection rationale:**
   - `lists = 200`: √500K ≈ 707; 200 lists gives ~2500 vectors/list, balancing index build time and query speed.
   - `probes = 10`: Searching 10/200 lists (5%) yields recall@10 = 0.998. More probes would increase recall further but with diminishing returns and higher latency.

## Production Guidance

For the FE-Radar production deployment:

- **ivfflat index** with lists=200, probes=10 is sufficient for 500K × 1024-dim at the 200 ms latency budget.
- **HNSW alternative** would offer slightly better query latency at higher build cost and memory usage; recommended if the corpus grows beyond 1M vectors.
- **Index rebuild** required after significant data changes (ivfflat is a static index; new inserts degrade recall over time).

## Dataset Provenance

Generated by `scripts/seed/generate-embedding-dataset.ts`:

- Seed: 54001
- Dimensions: 1024
- PRNG: Mulberry32 (via `scripts/seed/lib/prng.ts`)
- Manifest: `scripts/seed/embedding-manifest.json`
- Sample: `scripts/seed/embedding-sample.jsonl` (10 rows)
