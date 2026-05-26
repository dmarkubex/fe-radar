import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { curateItem, type CuratorInput } from "@fe-radar/core";
import { createPrng, prngInt, prngPick } from "./lib/prng";

const SEED = 54_002;
const SAMPLE_COUNT = 500;

const DEFAULT_CONFIG: CuratorInput["config"] = {
  weights: { w1: 0.2, w2: 0.25, w3: 0.2, w4: 0.15, w5: 0.2 },
  tCoef: { T1: 1, T2: 0.85, T3: 0.7 },
  cCoef: { C1: 1.2, C2: 1, C3: 0.85 },
  thresholds: {
    "政策与标准": { C1: 55, C2: 60, C3: 65 },
    "市场与价格": { C1: 55, C2: 60, C3: 70 },
    "技术与产品": { C1: 55, C2: 65, C3: 75 },
    "项目与招投标": { C1: 50, C2: 60, C3: 70 },
    "公司与资本": { C1: 55, C2: 65, C3: 75 },
  },
};

const CATEGORIES = Object.keys(DEFAULT_CONFIG.thresholds ?? {});
const TIERS = ["T1", "T2", "T3"] as const;
const CIRCLES = ["C1", "C2", "C3"] as const;

interface BacktestSample {
  id: number;
  expectedScore: number;
  expectedCurated: boolean;
  input: CuratorInput;
}

function buildSample(id: number, rng: () => number): BacktestSample {
  const category = prngPick(rng, CATEGORIES);
  const tier = prngPick(rng, TIERS);
  const circle = prngPick(rng, CIRCLES);
  const input: CuratorInput = {
    atoms: {
      d1Policy: prngInt(rng, 20, 95),
      d3Market: prngInt(rng, 20, 95),
      d4Tech: prngInt(rng, 20, 95),
      d5Business: prngInt(rng, 20, 95),
    },
    source: { tier },
    entities: [{ id: id * 10, type: "company", canonicalName: `实体-${id}`, circle }],
    category,
    config: DEFAULT_CONFIG,
  };
  const result = curateItem(input);
  return {
    id,
    expectedScore: result.qualityScore,
    expectedCurated: result.isCurated,
    input,
  };
}

function main(): void {
  const rng = createPrng(SEED);
  const samples: BacktestSample[] = [];
  for (let id = 1; id <= SAMPLE_COUNT; id += 1) {
    samples.push(buildSample(id, rng));
  }

  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const outPath = join(repoRoot, "scripts/samples/scoring-backtest.synthetic.json");
  writeFileSync(outPath, `${JSON.stringify(samples, null, 2)}\n`);
  console.log(`wrote ${outPath} (${samples.length} samples, seed=${SEED})`);
}

main();
