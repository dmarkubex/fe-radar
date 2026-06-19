/**
 * Dry-run helper for international source expansion candidates.
 *
 * This script reads spec/source-expansion-international/candidates.json,
 * validates the no-enabling guardrails, and prints either a table or JSON.
 * It does not write files, mutate the database, or enable any source.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SourceTier = "T1" | "T2" | "T3";
type FetcherGuessType = "rss" | "html" | "playwright" | "crawl";
type RobotsStatus =
  | "pending_manual_check"
  | "allows_fetch"
  | "disallows_fetch"
  | "robots_unavailable"
  | "manual_review_required";

interface Candidate {
  id: string;
  name: string;
  homepageUrl: string;
  country: string;
  lang: string;
  topicTags: string[];
  sourceIntent: string;
  tier: SourceTier;
  fetcherGuess: {
    type: FetcherGuessType;
    url?: string;
    listUrl?: string;
    selectorsStatus?: string;
  };
  robotsUrl: string;
  robotsStatus: RobotsStatus;
  enabledDefault: false;
  entityCircleAssignment: null;
}

interface CandidateArtifact {
  schemaVersion: number;
  artifactDate: string;
  defaultEnabled: false;
  candidates: Candidate[];
}

interface RobotsProbe {
  status: RobotsStatus;
  httpStatus?: number;
  note: string;
}

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const checkRobots = args.has("--check-robots");
const artifactPath = resolve(
  process.cwd(),
  "spec/source-expansion-international/candidates.json"
);

function readArtifact(): CandidateArtifact {
  return JSON.parse(readFileSync(artifactPath, "utf8")) as CandidateArtifact;
}

function assertNeverEnabled(artifact: CandidateArtifact): void {
  if (artifact.defaultEnabled !== false) {
    throw new Error("artifact.defaultEnabled must be false");
  }

  const ids = new Set<string>();
  for (const candidate of artifact.candidates) {
    if (ids.has(candidate.id)) {
      throw new Error(`duplicate candidate id: ${candidate.id}`);
    }
    ids.add(candidate.id);

    if (candidate.enabledDefault !== false) {
      throw new Error(`${candidate.id}: enabledDefault must be false`);
    }
    if (candidate.entityCircleAssignment !== null) {
      throw new Error(`${candidate.id}: entityCircleAssignment must stay null`);
    }
    if (!candidate.robotsStatus) {
      throw new Error(`${candidate.id}: robotsStatus is required`);
    }
    if (candidate.fetcherGuess.type === "rss" && !candidate.fetcherGuess.url) {
      throw new Error(`${candidate.id}: rss fetcherGuess requires url`);
    }
    if (
      candidate.fetcherGuess.type === "html" &&
      !candidate.fetcherGuess.listUrl
    ) {
      throw new Error(`${candidate.id}: html fetcherGuess requires listUrl`);
    }
  }
}

function classifyRobotsTxt(body: string): RobotsStatus {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim().toLowerCase())
    .filter(Boolean);

  let inWildcardBlock = false;
  let sawWildcardBlock = false;
  for (const line of lines) {
    if (line.startsWith("user-agent:")) {
      inWildcardBlock = line.slice("user-agent:".length).trim() === "*";
      sawWildcardBlock ||= inWildcardBlock;
      continue;
    }
    if (!inWildcardBlock || !line.startsWith("disallow:")) continue;
    const path = line.slice("disallow:".length).trim();
    if (path === "/") return "manual_review_required";
  }

  return sawWildcardBlock ? "allows_fetch" : "manual_review_required";
}

async function probeRobots(candidate: Candidate): Promise<RobotsProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(candidate.robotsUrl, {
      signal: controller.signal,
      headers: { "user-agent": "FE-Radar Source Prep/1.0" }
    });
    if (!response.ok) {
      return {
        status: "robots_unavailable",
        httpStatus: response.status,
        note: `robots fetch returned HTTP ${response.status}`
      };
    }
    const body = await response.text();
    const status = classifyRobotsTxt(body);
    return {
      status,
      httpStatus: response.status,
      note:
        status === "allows_fetch"
          ? "robots.txt has no wildcard full-site disallow; selector/feed review still required"
          : "robots.txt requires manual review before promotion"
    };
  } catch (error) {
    return {
      status: "robots_unavailable",
      note: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printTable(
  artifact: CandidateArtifact,
  probes: Record<string, RobotsProbe>
): void {
  console.log(
    `International source candidates v${artifact.schemaVersion} (${artifact.artifactDate})`
  );
  console.log(
    "All rows are disabled by default and have no entity circle assignment.\n"
  );
  console.log("tier\tcountry\tlang\tfetcher\trobots\tid\tname");
  for (const candidate of artifact.candidates) {
    const robots = probes[candidate.id]?.status ?? candidate.robotsStatus;
    console.log(
      [
        candidate.tier,
        candidate.country,
        candidate.lang,
        candidate.fetcherGuess.type,
        robots,
        candidate.id,
        candidate.name
      ].join("\t")
    );
  }
}

async function main(): Promise<void> {
  const artifact = readArtifact();
  assertNeverEnabled(artifact);

  const probes: Record<string, RobotsProbe> = {};
  if (checkRobots) {
    for (const candidate of artifact.candidates) {
      probes[candidate.id] = await probeRobots(candidate);
    }
  }

  if (outputJson) {
    console.log(JSON.stringify({ ...artifact, robotsProbe: probes }, null, 2));
    return;
  }

  printTable(artifact, probes);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
