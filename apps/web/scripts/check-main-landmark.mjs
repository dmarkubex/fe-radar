import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const allowed = new Set([
  "app/auth/login/page.tsx",
  "components/layout/app-shell.tsx"
]);
const files = (await readdir(root, { recursive: true }))
  .filter((file) => /\.(?:ts|tsx)$/.test(file))
  .filter((file) => !file.startsWith(".next/") && !file.startsWith("node_modules/"));
const found = new Map();

for (const file of files) {
  const content = await readFile(resolve(root, file), "utf8");
  const count = content.match(/<main\b/g)?.length ?? 0;
  if (count > 0) found.set(relative(root, resolve(root, file)), count);
}

const invalid = [...found].filter(([file, count]) => !allowed.has(file) || count !== 1);
const missing = [...allowed].filter((file) => found.get(file) !== 1);

if (invalid.length > 0 || missing.length > 0) {
  for (const [file, count] of invalid) {
    process.stderr.write(`unexpected <main>: ${file} (${count})\n`);
  }
  for (const file of missing) {
    process.stderr.write(`expected exactly one <main>: ${file}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("main landmark check passed: app-shell.tsx + auth/login/page.tsx\n");
}
