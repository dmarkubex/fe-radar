import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scrubText } from "../packages/core/src/index";

const LABEL_FILES = {
  prefilter: "spec/labels/prefilter/inputs/real-kyo58-prefilter-inputs.csv",
  ner: "spec/labels/ner/inputs/real-kyo58-ner-inputs.jsonl",
  scorer: "spec/labels/scorer/inputs/real-kyo58-scorer-inputs.json",
  scrubber: "spec/labels/scrubber/inputs/real-kyo58-scrubber-inputs.jsonl",
  backtest: "spec/labels/backtest/inputs/real-kyo58-backtest-inputs.json"
} as const;

const META_COUNTS_FILE = "spec/labels/_meta/sample-counts.json";
const EXAMPLE_LIMIT = 8;

export const M2_THRESHOLDS = {
  prefilterAccuracyMin: 0.8,
  nerRecallMin: 0.75,
  scorerScoreMseMax: 15,
  scrubberRecallMin: 0.95,
  scrubberFalsePositiveRateMax: 0.05,
  backtestPearsonMin: 0.7
} as const;

type LabelClass = keyof typeof LABEL_FILES;
type GateStatus = "pass" | "fail" | "blocked";
type CountStatus = "pass" | "fail";
type OverallStatus = GateStatus;

interface GateResult {
  status: GateStatus;
  metricName: string;
  metricValue?: number;
  threshold: string;
  detail: string;
}

interface ClassReport {
  className: LabelClass;
  path: string;
  expectedCount: number | null;
  actualCount: number;
  countStatus: CountStatus;
  missingLabels: number;
  missingExamples: string[];
  gate: GateResult;
}

export interface M2LabelReport {
  generatedAt: string;
  root: string;
  source?: string;
  sourceTotal?: number;
  overallStatus: OverallStatus;
  classes: ClassReport[];
}

type JsonRecord = Record<string, unknown>;

interface MetaCounts {
  source?: string;
  source_total?: number;
  class_counts?: Partial<Record<LabelClass, number>>;
}

interface ScrubberTotals {
  expected: number;
  predicted: number;
  truePositive: number;
  falsePositive: number;
}

export function evaluateM2Labels(root = process.cwd()): M2LabelReport {
  const resolvedRoot = resolve(root);
  const meta = readJson<MetaCounts>(resolvedRoot, META_COUNTS_FILE);
  const prefilterRows = readCsv(resolve(resolvedRoot, LABEL_FILES.prefilter));
  const nerRows = readJsonl(resolve(resolvedRoot, LABEL_FILES.ner));
  const scorerRows = readJsonArray(resolve(resolvedRoot, LABEL_FILES.scorer));
  const scrubberRows = readJsonl(resolve(resolvedRoot, LABEL_FILES.scrubber));
  const backtestRows = readJsonArray(resolve(resolvedRoot, LABEL_FILES.backtest));

  const classes: ClassReport[] = [
    buildClassReport("prefilter", resolvedRoot, meta, prefilterRows, findMissingPrefilterLabels, evaluatePrefilter),
    buildClassReport("ner", resolvedRoot, meta, nerRows, findMissingNerLabels, evaluateNer),
    buildClassReport("scorer", resolvedRoot, meta, scorerRows, findMissingScorerLabels, evaluateScorer),
    buildClassReport("scrubber", resolvedRoot, meta, scrubberRows, findMissingScrubberLabels, evaluateScrubber),
    buildClassReport("backtest", resolvedRoot, meta, backtestRows, findMissingBacktestLabels, evaluateBacktest)
  ];

  return {
    generatedAt: new Date().toISOString(),
    root: resolvedRoot,
    source: meta.source,
    sourceTotal: meta.source_total,
    overallStatus: computeOverallStatus(classes),
    classes
  };
}

export function renderMarkdownReport(report: M2LabelReport): string {
  const countRows = report.classes.map((item) =>
    `| ${item.className} | ${item.path} | ${formatNullable(item.expectedCount)} | ${item.actualCount} | ${item.countStatus} |`
  );
  const missingRows = report.classes.map((item) => {
    const examples = item.missingExamples.length > 0 ? item.missingExamples.join(", ") : "-";
    return `| ${item.className} | ${item.missingLabels} | ${examples} |`;
  });
  const metricRows = report.classes.map((item) =>
    [
      item.className,
      item.gate.metricName,
      formatMetric(item.gate.metricValue),
      item.gate.threshold,
      item.gate.status,
      item.gate.detail
    ].join(" | ")
  );

  return [
    "# M2 Label Package Gate Report",
    "",
    `- generated_at: ${report.generatedAt}`,
    `- root: ${report.root}`,
    `- source: ${report.source ?? "unknown"}`,
    `- source_total: ${formatNullable(report.sourceTotal ?? null)}`,
    `- overall_status: ${report.overallStatus}`,
    "",
    "## Count Reconciliation",
    "",
    "| class | sample_path | expected_count | actual_count | status |",
    "|---|---|---:|---:|---|",
    ...countRows,
    "",
    "## Missing Manual Labels",
    "",
    "Rows listed here block metric computation. Empty model/reference fields never count as human truth.",
    "",
    "| class | missing_labels | sample_ids |",
    "|---|---:|---|",
    ...missingRows,
    "",
    "## Metric Gates",
    "",
    "| class | metric | value | threshold | verdict | detail |",
    "|---|---|---:|---|---|---|",
    ...metricRows.map((row) => `| ${row} |`),
    "",
    "## Label Contract",
    "",
    "- prefilter: `label` must be `related` or `unrelated`; `model_suggestion` is treated only as a model prediction.",
    "- ner: `entities[]` with `type`, `text`, `start`, and `end` is human truth; empty entities require `annotator` or `reviewer` to distinguish a reviewed negative sample from an unlabeled sample.",
    "- scorer: `expected.d1Policy`, `expected.d3Market`, `expected.d4Tech`, `expected.d5Business`, and `expected.qualityScore` are human truth; `model_reference.*` is only prediction/reference output.",
    "- scrubber: `expectedRedactions[]` is human truth; empty arrays require `annotator` or `reviewer`; the evaluator runs `packages/core/scrubber.ts` for predictions.",
    "- backtest: `expected.*` including `curated` is human truth; `reference.modelQualityScore` is only prediction/reference output.",
    ""
  ].join("\n");
}

function buildClassReport(
  className: LabelClass,
  root: string,
  meta: MetaCounts,
  rows: JsonRecord[],
  missingFinder: (rows: JsonRecord[]) => JsonRecord[],
  evaluator: (rows: JsonRecord[], missingLabels: number) => GateResult
): ClassReport {
  const expectedCount = meta.class_counts?.[className] ?? null;
  const actualCount = rows.length;
  const missingRows = missingFinder(rows);
  return {
    className,
    path: relative(root, resolve(root, LABEL_FILES[className])),
    expectedCount,
    actualCount,
    countStatus: expectedCount === null || expectedCount === actualCount ? "pass" : "fail",
    missingLabels: missingRows.length,
    missingExamples: missingRows.slice(0, EXAMPLE_LIMIT).map((row) => String(row.id ?? "(missing id)")),
    gate: evaluator(rows, missingRows.length)
  };
}

function evaluatePrefilter(rows: JsonRecord[], missingLabels: number): GateResult {
  if (missingLabels > 0) {
    return blocked("prefilter_accuracy", `blocked/missing labels: ${missingLabels} rows lack related/unrelated human labels`, `>= ${M2_THRESHOLDS.prefilterAccuracyMin}`);
  }

  const predictions = rows.map((row) => normalizeRelated(row.model_suggestion ?? row.modelPrediction ?? row.prediction));
  const missingPredictions = predictions.filter((value) => value === null).length;
  if (missingPredictions > 0) {
    return blocked("prefilter_accuracy", `blocked/missing model outputs: ${missingPredictions} rows lack model_suggestion`, `>= ${M2_THRESHOLDS.prefilterAccuracyMin}`);
  }

  const correct = rows.filter((row, index) => normalizeRelated(row.label) === predictions[index]).length;
  const accuracy = correct / Math.max(1, rows.length);
  return gate("prefilter_accuracy", accuracy, accuracy >= M2_THRESHOLDS.prefilterAccuracyMin, `>= ${M2_THRESHOLDS.prefilterAccuracyMin}`, `${correct}/${rows.length} predictions match human labels`);
}

function evaluateNer(rows: JsonRecord[], missingLabels: number): GateResult {
  if (missingLabels > 0) {
    return blocked("ner_recall", `blocked/missing labels: ${missingLabels} rows lack reviewed entity labels`, `>= ${M2_THRESHOLDS.nerRecallMin}`);
  }

  const allExpected = rows.flatMap((row) => normalizeEntities(asArray(row.entities)));
  if (allExpected.length === 0) {
    return blocked("ner_recall", "blocked/missing positive labels: no expected entities are present", `>= ${M2_THRESHOLDS.nerRecallMin}`);
  }

  const predictionRows = rows.map((row) => pickPredictedEntities(row));
  const missingPredictions = predictionRows.filter((items) => items === null).length;
  if (missingPredictions > 0) {
    return blocked("ner_recall", `blocked/missing model outputs: ${missingPredictions} rows lack predictedEntities/model_entities`, `>= ${M2_THRESHOLDS.nerRecallMin}`);
  }

  // Per-document recall: match each document's expected entities only against
  // that same document's predicted entities, preventing cross-document false matches.
  let totalExpected = 0;
  let totalMatched = 0;
  for (let i = 0; i < rows.length; i++) {
    const docExpected = normalizeEntities(asArray(rows[i]!.entities));
    if (docExpected.length === 0) continue;
    const docPredictedKeys = new Set(
      normalizeEntities(predictionRows[i] ?? []).map((entity) => entityKey(entity))
    );
    totalExpected += docExpected.length;
    totalMatched += docExpected.filter((entity) => docPredictedKeys.has(entityKey(entity))).length;
  }
  const recall = totalExpected === 0 ? 0 : totalMatched / totalExpected;
  return gate("ner_recall", recall, recall >= M2_THRESHOLDS.nerRecallMin, `>= ${M2_THRESHOLDS.nerRecallMin}`, `${totalMatched}/${totalExpected} expected entities matched exactly by type/text (per-doc)`);
}

function evaluateScorer(rows: JsonRecord[], missingLabels: number): GateResult {
  if (missingLabels > 0) {
    return blocked("scorer_score_mse", `blocked/missing labels: ${missingLabels} rows lack expected score fields`, `<= ${M2_THRESHOLDS.scorerScoreMseMax}`);
  }

  const pairs = rows.map((row) => ({
    expected: asRecord(row.expected),
    predicted: asRecord(row.model_reference ?? row.modelReference ?? row.prediction)
  }));
  const missingPredictions = pairs.filter((pair) => !isFiniteNumber(pair.predicted?.qualityScore)).length;
  if (missingPredictions > 0) {
    return blocked("scorer_score_mse", `blocked/missing model outputs: ${missingPredictions} rows lack model_reference.qualityScore`, `<= ${M2_THRESHOLDS.scorerScoreMseMax}`);
  }

  const scoreMse = mean(pairs.map((pair) => square(asNumber(pair.predicted?.qualityScore) - asNumber(pair.expected?.qualityScore))));
  const atomNames = ["d1Policy", "d3Market", "d4Tech", "d5Business"] as const;
  const atomMse = mean(
    pairs.flatMap((pair) => atomNames.map((name) => square(asNumber(pair.predicted?.[name]) - asNumber(pair.expected?.[name]))))
  );
  const atomMseDisplay = Number.isFinite(atomMse) ? atomMse.toFixed(3) : "N/A";
  return gate("scorer_score_mse", scoreMse, scoreMse <= M2_THRESHOLDS.scorerScoreMseMax, `<= ${M2_THRESHOLDS.scorerScoreMseMax}`, `qualityScore MSE; atom_mse=${atomMseDisplay}`);
}

function evaluateScrubber(rows: JsonRecord[], missingLabels: number): GateResult {
  if (missingLabels > 0) {
    return blocked("scrubber_recall_fp", `blocked/missing labels: ${missingLabels} rows lack reviewed expectedRedactions`, `recall >= ${M2_THRESHOLDS.scrubberRecallMin}, fp_rate <= ${M2_THRESHOLDS.scrubberFalsePositiveRateMax}`);
  }

  const totals = rows.reduce<ScrubberTotals>(
    (acc, row) => {
      const rawText = typeof row.rawText === "string" ? row.rawText : "";
      const result = scrubText(rawText, { projectCodes: normalizeProjectCodes(row.projectCodes) });
      const expectedCounts = countExpectedRedactions(asArray(row.expectedRedactions));
      const predictedCounts = countPredictedRedactions(result.redactions);
      const allTypes = new Set([...Object.keys(expectedCounts), ...Object.keys(predictedCounts)]);
      for (const type of allTypes) {
        const expectedCount = expectedCounts[type] ?? 0;
        const predictedCount = predictedCounts[type] ?? 0;
        acc.expected += expectedCount;
        acc.predicted += predictedCount;
        acc.truePositive += Math.min(expectedCount, predictedCount);
        acc.falsePositive += Math.max(0, predictedCount - expectedCount);
      }
      return acc;
    },
    { expected: 0, predicted: 0, truePositive: 0, falsePositive: 0 }
  );

  if (totals.expected === 0) {
    return blocked("scrubber_recall_fp", "blocked/missing positive labels: no expected redactions are present", `recall >= ${M2_THRESHOLDS.scrubberRecallMin}, fp_rate <= ${M2_THRESHOLDS.scrubberFalsePositiveRateMax}`);
  }

  const recall = totals.truePositive / totals.expected;
  const falsePositiveRate = totals.falsePositive / Math.max(1, totals.predicted);
  const passed = recall >= M2_THRESHOLDS.scrubberRecallMin && falsePositiveRate <= M2_THRESHOLDS.scrubberFalsePositiveRateMax;
  return gate("scrubber_recall_fp", recall, passed, `recall >= ${M2_THRESHOLDS.scrubberRecallMin}, fp_rate <= ${M2_THRESHOLDS.scrubberFalsePositiveRateMax}`, `recall=${recall.toFixed(3)}, fp_rate=${falsePositiveRate.toFixed(3)}, tp=${totals.truePositive}, fp=${totals.falsePositive}`);
}

function evaluateBacktest(rows: JsonRecord[], missingLabels: number): GateResult {
  if (missingLabels > 0) {
    return blocked("backtest_pearson", `blocked/missing labels: ${missingLabels} rows lack expected score/curated fields`, `>= ${M2_THRESHOLDS.backtestPearsonMin}`);
  }

  const pairs = rows.map((row) => ({
    expected: asRecord(row.expected),
    predicted: asRecord(row.reference ?? row.model_reference ?? row.modelReference ?? row.prediction)
  }));
  const missingPredictions = pairs.filter((pair) => !isFiniteNumber(pair.predicted?.modelQualityScore) && !isFiniteNumber(pair.predicted?.qualityScore)).length;
  if (missingPredictions > 0) {
    return blocked("backtest_pearson", `blocked/missing model outputs: ${missingPredictions} rows lack reference.modelQualityScore`, `>= ${M2_THRESHOLDS.backtestPearsonMin}`);
  }

  const expectedScores = pairs.map((pair) => asNumber(pair.expected?.qualityScore));
  // Use explicit isFiniteNumber fallback instead of ?? to correctly handle
  // non-null but non-finite values (e.g. a string "garbage" for modelQualityScore).
  const predictedScores = pairs.map((pair) => {
    const mqs = pair.predicted?.modelQualityScore;
    const qs = pair.predicted?.qualityScore;
    return asNumber(isFiniteNumber(mqs) ? mqs : qs);
  });
  const pearson = pearsonCorrelation(expectedScores, predictedScores);
  if (pearson === null) {
    return blocked("backtest_pearson", "blocked/insufficient variance: Pearson requires at least two non-constant score series", `>= ${M2_THRESHOLDS.backtestPearsonMin}`);
  }
  return gate("backtest_pearson", pearson, pearson >= M2_THRESHOLDS.backtestPearsonMin, `>= ${M2_THRESHOLDS.backtestPearsonMin}`, `${rows.length} labeled historical samples`);
}

function findMissingPrefilterLabels(rows: JsonRecord[]): JsonRecord[] {
  return rows.filter((row) => normalizeRelated(row.label) === null);
}

function findMissingNerLabels(rows: JsonRecord[]): JsonRecord[] {
  return rows.filter((row) => {
    const entities = asArray(row.entities);
    if (!Array.isArray(row.entities)) return true;
    if (entities.length === 0) return !hasReviewer(row);
    return normalizeEntities(entities).length !== entities.length;
  });
}

function findMissingScorerLabels(rows: JsonRecord[]): JsonRecord[] {
  const required = ["d1Policy", "d3Market", "d4Tech", "d5Business", "qualityScore"] as const;
  return rows.filter((row) => {
    const expected = asRecord(row.expected);
    return expected === null || required.some((name) => !isFiniteNumber(expected[name]));
  });
}

function findMissingScrubberLabels(rows: JsonRecord[]): JsonRecord[] {
  return rows.filter((row) => {
    const redactions = asArray(row.expectedRedactions);
    if (!Array.isArray(row.expectedRedactions)) return true;
    if (redactions.length === 0) return !hasReviewer(row);
    return redactions.some((redaction) => {
      const item = asRecord(redaction);
      return item === null || typeof item.type !== "string" || typeof item.text !== "string" || item.text.trim().length === 0;
    });
  });
}

function findMissingBacktestLabels(rows: JsonRecord[]): JsonRecord[] {
  const required = ["d1Policy", "d3Market", "d4Tech", "d5Business", "qualityScore"] as const;
  return rows.filter((row) => {
    const expected = asRecord(row.expected);
    return expected === null || required.some((name) => !isFiniteNumber(expected[name])) || typeof expected.curated !== "boolean";
  });
}

function readJson<T>(root: string, filePath: string): T {
  return JSON.parse(readFileSync(resolve(root, filePath), "utf8")) as T;
}

function readJsonArray(filePath: string): JsonRecord[] {
  const value = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(value)) {
    throw new Error(`${filePath} must contain a JSON array`);
  }
  return value.map((item) => {
    const record = asRecord(item);
    if (record === null) throw new Error(`${filePath} contains a non-object row`);
    return record;
  });
}

function readJsonl(filePath: string): JsonRecord[] {
  return readFileSync(filePath, "utf8")
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const record = asRecord(JSON.parse(line) as unknown);
      if (record === null) throw new Error(`${filePath}:${index + 1} is not an object`);
      return record;
    });
}

function readCsv(filePath: string): JsonRecord[] {
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const headers = rows[0] ?? [];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const record: JsonRecord = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function normalizeRelated(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["related", "true", "1", "yes"].includes(normalized)) return true;
  if (["unrelated", "false", "0", "no"].includes(normalized)) return false;
  return null;
}

interface NormalizedEntity {
  type: string;
  text: string;
}

function normalizeEntities(items: unknown[]): NormalizedEntity[] {
  return items.flatMap((item) => {
    const record = asRecord(item);
    if (record === null || typeof record.type !== "string" || typeof record.text !== "string") return [];
    if (!isFiniteNumber(record.start) || !isFiniteNumber(record.end)) return [];
    const text = record.text.trim();
    const type = record.type.trim();
    if (text.length === 0 || type.length === 0) return [];
    return [{ type, text }];
  });
}

function pickPredictedEntities(row: JsonRecord): unknown[] | null {
  const candidates = [
    row.predictedEntities,
    row.model_entities,
    row.modelEntities,
    asRecord(row.prediction)?.entities,
    asRecord(row.model_reference)?.entities,
    asRecord(row.modelReference)?.entities
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return null;
}

function entityKey(entity: NormalizedEntity): string {
  return `${entity.type.trim().toLowerCase()}\u0000${entity.text.trim()}`;
}

function countExpectedRedactions(items: unknown[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const record = asRecord(item);
    if (record === null || typeof record.type !== "string") continue;
    const type = normalizeRedactionType(record.type);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function countPredictedRedactions(items: Array<{ type: string; count: number }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const type = normalizeRedactionType(item.type);
    counts[type] = (counts[type] ?? 0) + item.count;
  }
  return counts;
}

function normalizeRedactionType(type: string): string {
  return type.trim().replace(/-/g, "_").toUpperCase();
}

function normalizeProjectCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasReviewer(row: JsonRecord): boolean {
  return [row.annotator, row.reviewer].some((value) => typeof value === "string" && value.trim().length > 0);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function square(value: number): number {
  return value * value;
}

function pearsonCorrelation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index]! - leftMean;
    const rightDelta = right[index]! - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator === 0 ? null : numerator / denominator;
}

function gate(metricName: string, value: number, passed: boolean, threshold: string, detail: string): GateResult {
  return {
    status: passed ? "pass" : "fail",
    metricName,
    metricValue: value,
    threshold,
    detail
  };
}

function blocked(metricName: string, detail: string, threshold: string): GateResult {
  return {
    status: "blocked",
    metricName,
    threshold,
    detail
  };
}

function computeOverallStatus(classes: ClassReport[]): OverallStatus {
  if (classes.some((item) => item.countStatus === "fail" || item.gate.status === "fail")) return "fail";
  if (classes.some((item) => item.gate.status === "blocked")) return "blocked";
  return "pass";
}

function formatNullable(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function formatMetric(value: number | undefined): string {
  return value === undefined ? "-" : value.toFixed(3);
}

function parseArgs(argv: string[]): { root: string; out?: string; strict: boolean } {
  const args = [...argv];
  let root = process.cwd();
  let out: string | undefined;
  let strict = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--root") {
      root = args.shift() ?? root;
    } else if (arg === "--out") {
      out = args.shift();
    } else if (arg === "--strict") {
      strict = true;
    } else if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { root, out, strict };
}

function printUsageAndExit(code: number): never {
  console.log("usage: tsx scripts/m2-label-evaluator.ts [--root <repo>] [--out <report.md>] [--strict]");
  process.exit(code);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = evaluateM2Labels(args.root);
  const markdown = renderMarkdownReport(report);
  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, markdown);
  } else {
    console.log(markdown);
  }
  if (args.strict && report.overallStatus !== "pass") {
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
