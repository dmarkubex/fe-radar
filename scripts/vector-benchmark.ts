import { performance } from "node:perf_hooks";

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

function main(): void {
  const dimensions = Number(process.env.VECTOR_BENCH_DIMENSIONS ?? 128);
  const rows = Number(process.env.VECTOR_BENCH_ROWS ?? 1000);
  const query = Array.from({ length: dimensions }, (_, index) => index / dimensions);
  const vectors = Array.from({ length: rows }, (_, row) => Array.from({ length: dimensions }, (_, index) => ((row + index) % 17) / 17));
  const startedAt = performance.now();
  vectors.map((vector, index) => ({ index, score: cosine(query, vector) })).sort((a, b) => b.score - a.score).slice(0, 10);
  const elapsedMs = performance.now() - startedAt;
  console.log(JSON.stringify({ rows, dimensions, topK: 10, elapsedMs: Math.round(elapsedMs * 100) / 100 }));
}

main();
