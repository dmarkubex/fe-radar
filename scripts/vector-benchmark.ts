import { performance } from "node:perf_hooks";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Client } from "pg";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let left = 0;
  let right = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index]! * b[index]!;
    left += a[index]! ** 2;
    right += b[index]! ** 2;
  }
  return dot / (Math.sqrt(left) * Math.sqrt(right));
}

function topK(vectors: number[][], query: number[], k: number): { index: number; score: number }[] {
  return vectors
    .map((vector, index) => ({ index, score: cosine(query, vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

interface VectorRecord {
  id: number;
  embedding: number[];
}

interface BenchmarkResult {
  rows: number;
  dimensions: number;
  queries: number;
  topK: number;
  recallAt10: number;
  latencyMs: {
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  indexType: string;
  indexParams?: Record<string, unknown>;
}

async function loadVectorsFromJsonl(jsonlPath: string, rows: number): Promise<VectorRecord[]> {
  const vectors: VectorRecord[] = [];
  const fileStream = createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let count = 0;
  for await (const line of rl) {
    if (line.trim()) {
      vectors.push(JSON.parse(line) as VectorRecord);
      count++;
      if (count >= rows) break;
    }
  }
  return vectors;
}

async function runPgvectorBenchmark(): Promise<BenchmarkResult> {
  const dimensions = Number(process.env.VECTOR_BENCH_DIMENSIONS ?? 1024);
  const rows = Number(process.env.VECTOR_BENCH_ROWS ?? 500000);
  const queries = Number(process.env.VECTOR_BENCH_QUERIES ?? 200);
  const topKCount = 10;
  const jsonlPath = process.env.VECTOR_BENCH_JSONL_PATH ?? (rows >= 500000
    ? "generated/embedding/vectors-500k.jsonl"
    : "generated/embedding/vectors-50k.jsonl");

  const pgHost = process.env.PGHOST ?? "localhost";
  const pgPort = Number(process.env.PGPORT ?? 5433);
  const pgUser = process.env.PGUSER ?? "postgres";
  const pgPassword = process.env.PGPASSWORD ?? "postgres";
  const pgDatabase = process.env.PGDATABASE ?? "postgres";

  const indexType = process.env.VECTOR_BENCH_INDEX_TYPE ?? "ivfflat";
  const ivfflatLists = Number(process.env.VECTOR_BENCH_IVFFLAT_LISTS ?? 200);
  const ivfflatProbes = Number(process.env.VECTOR_BENCH_IVFFLAT_PROBES ?? 10);
  const hnswM = Number(process.env.VECTOR_BENCH_HNSW_M ?? 16);
  const hnswEfConstruction = Number(process.env.VECTOR_BENCH_HNSW_EF_CONSTRUCTION ?? 64);
  const hnswEfSearch = Number(process.env.VECTOR_BENCH_HNSW_EF_SEARCH ?? 40);

  console.error(`[pgvector] Connecting to ${pgHost}:${pgPort}...`);
  const client = new Client({
    host: pgHost,
    port: pgPort,
    user: pgUser,
    password: pgPassword,
    database: pgDatabase,
  });
  await client.connect();

  await client.query("CREATE EXTENSION IF NOT EXISTS vector;");

  console.error(`[pgvector] Creating table embeddings (vector(${dimensions}))...`);
  await client.query("DROP TABLE IF EXISTS embeddings;");
  await client.query(`CREATE TABLE embeddings (id INT PRIMARY KEY, vector vector(${dimensions}));`);

  console.error(`[pgvector] Loading ${rows} vectors from ${jsonlPath}...`);
  const vectors = await loadVectorsFromJsonl(jsonlPath, rows);

  if (vectors.length !== rows) {
    throw new Error(`Expected ${rows} rows, got ${vectors.length}`);
  }

  const batchSize = 1000;
  for (let i = 0; i < vectors.length; i += batchSize) {
    const batch = vectors.slice(i, i + batchSize);
    const values = batch.map((v, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(",");
    const params = batch.flatMap((v) => [v.id, `[${v.embedding.join(",")}]`]);
    await client.query(`INSERT INTO embeddings (id, vector) VALUES ${values}`, params);
    if ((i + batchSize) % 50000 === 0) {
      console.error(`[pgvector] Inserted ${Math.min(i + batchSize, rows)}/${rows} vectors...`);
    }
  }
  console.error(`[pgvector] All ${rows} vectors loaded.`);

  let indexParams: Record<string, unknown>;
  if (indexType === "ivfflat") {
    console.error(`[pgvector] Creating ivfflat index with lists=${ivfflatLists}...`);
    await client.query(
      `CREATE INDEX embeddings_vector_idx ON embeddings USING ivfflat (vector vector_cosine_ops) WITH (lists = ${ivfflatLists});`,
    );
    indexParams = { type: "ivfflat", lists: ivfflatLists, probes: ivfflatProbes };
    await client.query(`SET ivfflat.probes = ${ivfflatProbes};`);
  } else if (indexType === "hnsw") {
    console.error(`[pgvector] Creating hnsw index with m=${hnswM}, ef_construction=${hnswEfConstruction}...`);
    await client.query(
      `CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (vector vector_cosine_ops) WITH (m = ${hnswM}, ef_construction = ${hnswEfConstruction});`,
    );
    indexParams = { type: "hnsw", m: hnswM, ef_construction: hnswEfConstruction, ef_search: hnswEfSearch };
    await client.query(`SET hnsw.ef_search = ${hnswEfSearch};`);
  } else {
    throw new Error(`Unknown index type: ${indexType}`);
  }

  const queryVectors = Array.from({ length: queries }, (_, qi) =>
    Array.from({ length: dimensions }, (_, dim) => ((qi * 31 + dim * 7) % 503) / 503),
  );

  const latencies: number[] = [];
  const recalls: number[] = [];

  const warmupQuery = queryVectors[0]!;
  await client.query(
    `SELECT id, 1 - (vector <=> $1) AS score FROM embeddings ORDER BY vector <=> $1 LIMIT ${topKCount}`,
    [`[${warmupQuery.join(",")}]`],
  );

  console.error(`[pgvector] Running ${queries} queries...`);
  for (const query of queryVectors) {
    const queryVec = `[${query.join(",")}]`;

    const t0 = performance.now();
    const result = await client.query<{ id: number; score: number }>(
      `SELECT id, 1 - (vector <=> $1) AS score FROM embeddings ORDER BY vector <=> $1 LIMIT ${topKCount}`,
      [queryVec],
    );
    const latency = performance.now() - t0;
    latencies.push(latency);

    const pgvectorIds = result.rows.map((r) => r.id);

    const groundTruth = topK(
      vectors.map((v) => v.embedding),
      query,
      topKCount,
    );
    const groundTruthIds = groundTruth.map((g) => vectors[g.index]!.id);

    const intersection = pgvectorIds.filter((id) => groundTruthIds.includes(id)).length;
    recalls.push(intersection / topKCount);
  }

  latencies.sort((a, b) => a - b);
  const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length;

  await client.end();

  return {
    rows,
    dimensions,
    queries,
    topK: topKCount,
    recallAt10: Math.round(avgRecall * 10000) / 10000,
    latencyMs: {
      p50: Math.round(percentile(latencies, 50) * 100) / 100,
      p95: Math.round(percentile(latencies, 95) * 100) / 100,
      p99: Math.round(percentile(latencies, 99) * 100) / 100,
      min: Math.round(latencies[0]! * 100) / 100,
      max: Math.round(latencies[latencies.length - 1]! * 100) / 100,
    },
    indexType: `pgvector-${indexType}`,
    indexParams,
  };
}

function main(): void {
  const mode = process.env.VECTOR_BENCH_MODE ?? "brute-force";

  if (mode === "pgvector") {
    runPgvectorBenchmark()
      .then((result) => {
        console.log(JSON.stringify(result, null, 2));
      })
      .catch((err) => {
        console.error("pgvector benchmark failed:", err);
        process.exit(1);
      });
  } else {
    const dimensions = Number(process.env.VECTOR_BENCH_DIMENSIONS ?? 128);
    const rows = Number(process.env.VECTOR_BENCH_ROWS ?? 1000);
    const queries = Number(process.env.VECTOR_BENCH_QUERIES ?? 200);
    const topKCount = 10;

    const vectors = Array.from({ length: rows }, (_, row) =>
      Array.from({ length: dimensions }, (_, dim) => ((row * 17 + dim * 13) % 997) / 997),
    );

    const queryVectors = Array.from({ length: queries }, (_, qi) =>
      Array.from({ length: dimensions }, (_, dim) => ((qi * 31 + dim * 7) % 503) / 503),
    );

    const latencies: number[] = [];

    topK(vectors, queryVectors[0]!, topKCount);

    for (const query of queryVectors) {
      const t0 = performance.now();
      topK(vectors, query, topKCount);
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);

    const recall = 1.0;

    const result: BenchmarkResult = {
      rows,
      dimensions,
      queries,
      topK: topKCount,
      recallAt10: recall,
      latencyMs: {
        p50: Math.round(percentile(latencies, 50) * 100) / 100,
        p95: Math.round(percentile(latencies, 95) * 100) / 100,
        p99: Math.round(percentile(latencies, 99) * 100) / 100,
        min: Math.round(latencies[0]! * 100) / 100,
        max: Math.round(latencies[latencies.length - 1]! * 100) / 100,
      },
      indexType: "brute-force-cosine (no pgvector index)",
    };

    console.log(JSON.stringify(result, null, 2));
  }
}

main();