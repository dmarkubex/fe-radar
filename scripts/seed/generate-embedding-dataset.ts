import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrng } from "./lib/prng";

const SEED = 54_001;
const DIMENSIONS = 1024;
const SIZES = [50_000, 500_000] as const;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outDir = join(repoRoot, "generated/embedding");
const manifestPath = join(dirname(fileURLToPath(import.meta.url)), "embedding-manifest.json");
const samplePath = join(dirname(fileURLToPath(import.meta.url)), "embedding-sample.jsonl");

interface VectorRow {
  id: number;
  embedding: number[];
}

function generateVector(rng: () => number, id: number): number[] {
  const embedding: number[] = [];
  for (let dim = 0; dim < DIMENSIONS; dim += 1) {
    embedding.push(((id * 17 + dim * 13) % 997) / 997 + rng() * 0.01);
  }
  return embedding;
}

function writeJsonl(path: string, rows: Iterable<VectorRow>): void {
  const stream = createWriteStream(path, { encoding: "utf8" });
  for (const row of rows) {
    stream.write(`${JSON.stringify(row)}\n`);
  }
  stream.end();
}

function* rowsForSize(size: number, rng: () => number): Generator<VectorRow> {
  for (let id = 1; id <= size; id += 1) {
    yield { id, embedding: generateVector(rng, id) };
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });

  const sampleRows: VectorRow[] = [];
  const sampleRng = createPrng(SEED);
  for (let id = 1; id <= 10; id += 1) {
    sampleRows.push({ id, embedding: generateVector(sampleRng, id) });
  }
  writeFileSync(samplePath, sampleRows.map((row) => JSON.stringify(row)).join("\n") + "\n");

  const manifest = {
    seed: SEED,
    dimensions: DIMENSIONS,
    datasets: [] as Array<{ name: string; rows: number; path: string; sha256: null | string }>,
    vectorBenchmark: {
      command50k: "VECTOR_BENCH_ROWS=50000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts",
      command500k: "VECTOR_BENCH_ROWS=500000 VECTOR_BENCH_DIMENSIONS=1024 pnpm exec tsx scripts/vector-benchmark.ts",
      note: "vector-benchmark.ts uses in-memory cosine search; row counts mirror generated dataset sizes.",
    },
  };

  for (const size of SIZES) {
    const rng = createPrng(SEED + size);
    const fileName = `vectors-${size / 1000}k.jsonl`;
    const path = join(outDir, fileName);
    writeJsonl(path, rowsForSize(size, rng));
    manifest.datasets.push({ name: fileName, rows: size, path: `generated/embedding/${fileName}`, sha256: null });
    console.log(`wrote ${path} (${size} rows × ${DIMENSIONS} dims)`);
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest: ${manifestPath}`);
  console.log(`sample: ${samplePath}`);
}

main();
