import { readFileSync } from "node:fs";

interface SourceSeed {
  name: string;
  url: string;
}

function parseSources(sql: string): SourceSeed[] {
  const rows = [...sql.matchAll(/\('([^']+)', '([^']+)',/g)];
  return rows.map((row) => ({ name: row[1] ?? "", url: row[2] ?? "" }));
}

async function check(url: string): Promise<boolean> {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(8000),
    headers: { "user-agent": "FE-Radar Bot (+https://fe-radar.internal/bot)" }
  });
  return response.status < 500;
}

async function main(): Promise<void> {
  const sqlPath = new URL("../migrations/0004_sources_seed.sql", import.meta.url);
  const sources = parseSources(readFileSync(sqlPath, "utf8"));
  const results = await Promise.allSettled(sources.map(async (source) => ({ ...source, ok: await check(source.url) })));
  const checked = results.map((result, index) => result.status === "fulfilled" ? result.value : { ...sources[index], ok: false });
  const okCount = checked.filter((item) => item.ok).length;
  const ratio = okCount / checked.length;

  for (const item of checked) {
    console.log(`${item.ok ? "OK" : "FAIL"}\t${item.name}\t${item.url}`);
  }
  console.log(`reachable=${okCount}/${checked.length} ratio=${(ratio * 100).toFixed(1)}%`);

  if (checked.length !== 37) {
    throw new Error(`Expected 37 sources, got ${checked.length}`);
  }
  if (ratio < 0.8) {
    throw new Error("Reachability is below 80%");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
