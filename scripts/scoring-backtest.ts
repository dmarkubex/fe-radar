import { readFileSync, writeFileSync } from "node:fs";
import { curateItem, type CuratorInput, type ScoringConfig } from "@fe-radar/core";

interface BacktestSample {
  id: number;
  expectedScore: number;
  expectedCurated: boolean;
  input: CuratorInput;
}

interface ReportRow {
  id: number;
  expectedScore: number;
  actualScore: number;
  scoreError: number;
  expectedCurated: boolean;
  actualCurated: boolean;
}

function main(): void {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("usage: tsx scripts/scoring-backtest.ts <samples.json> [candidate-config.json] [report.md]");
  }

  const samples = JSON.parse(readFileSync(inputPath, "utf8")) as BacktestSample[];
  const candidateConfig = process.argv[3] ? JSON.parse(readFileSync(process.argv[3]!, "utf8")) as Partial<ScoringConfig> : undefined;
  const rows = samples.map((sample) => {
    const input = candidateConfig ? { ...sample.input, config: { ...sample.input.config, ...candidateConfig } } : sample.input;
    const result = curateItem(input);
    return {
      id: sample.id,
      expectedScore: sample.expectedScore,
      actualScore: result.qualityScore,
      scoreError: Math.abs(result.qualityScore - sample.expectedScore),
      expectedCurated: sample.expectedCurated,
      actualCurated: result.isCurated
    };
  });

  const report = renderReport(rows);
  if (process.argv[4]) {
    writeFileSync(process.argv[4]!, report);
  } else {
    console.log(report);
  }
}

function renderReport(rows: ReportRow[]): string {
  const accuracy = rows.filter((row) => row.expectedCurated === row.actualCurated).length / Math.max(1, rows.length);
  const meanAbsoluteError = rows.reduce((sum, row) => sum + row.scoreError, 0) / Math.max(1, rows.length);
  const curatedOverlap = overlap(
    rows.filter((row) => row.expectedCurated).map((row) => row.id),
    rows.filter((row) => row.actualCurated).map((row) => row.id)
  );

  return [
    "# Scoring Backtest Report",
    "",
    `- samples: ${rows.length}`,
    `- accuracy: ${accuracy.toFixed(3)}`,
    `- mean_absolute_error: ${meanAbsoluteError.toFixed(2)}`,
    `- curated_overlap: ${curatedOverlap.toFixed(3)}`,
    "",
    "| id | expected | actual | abs_error | expected_curated | actual_curated |",
    "|---:|---:|---:|---:|:---:|:---:|",
    ...rows.map((row) => `| ${row.id} | ${row.expectedScore} | ${row.actualScore} | ${row.scoreError.toFixed(2)} | ${row.expectedCurated} | ${row.actualCurated} |`)
  ].join("\n");
}

function overlap(left: number[], right: number[]): number {
  const rightSet = new Set(right);
  const intersection = left.filter((id) => rightSet.has(id)).length;
  return intersection / Math.max(1, new Set([...left, ...right]).size);
}

main();
