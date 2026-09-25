// `tsx e2e/guards/run.ts [--allow-planned]`: the pre-run guard. Reads the
// matrix, CONTEXT.md, the shortcut registry, App.tsx routes and every e2e
// file, and exits 1 with one line per problem. `pnpm test:e2e` runs it before
// Playwright and never passes --allow-planned.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EXCLUSIONS, ROWS } from "../coverage-matrix";
import { checkCoverage, type SourceFile } from "./coverage";

const root = resolve(import.meta.dirname, "../..");
const allowPlanned = process.argv.includes("--allow-planned");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function walk(dir: string, skip: (rel: string) => boolean): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name).split("\\").join("/");
    if (skip(rel)) continue;
    if (entry.isDirectory()) out.push(...walk(rel, skip));
    else if (/\.(ts|mjs)$/.test(entry.name)) out.push({ path: rel, source: read(rel) });
  }
  return out;
}

const specs = walk("e2e/specs", () => false);
const otherE2eFiles = walk(
  "e2e",
  (rel) =>
    rel === "e2e/specs" ||
    rel === "e2e/guards" ||
    rel === "e2e/.output" ||
    rel.includes("node_modules")
);

const problems = checkCoverage({
  rows: ROWS,
  exclusions: EXCLUSIONS,
  contextMd: read("CONTEXT.md"),
  shortcutRegistrySource: read("src/lib/shortcut-registry.ts"),
  appRoutesSource: read("src/App.tsx"),
  specs,
  otherE2eFiles,
  allowPlanned,
});

const counts = ROWS.reduce<Record<string, number>>((acc, row) => {
  acc[row.status] = (acc[row.status] ?? 0) + 1;
  return acc;
}, {});
const summary = Object.entries(counts)
  .map(([status, n]) => `${n} ${status}`)
  .join(", ");

if (problems.length > 0) {
  console.error(`E2E guard: ${problems.length} problem(s) (${ROWS.length} rows: ${summary})\n`);
  for (const p of problems) console.error(`  [${p.code}] ${p.message}`);
  console.error(
    `\nSee e2e/README.md, "Coverage matrix and guards". Checked from ${relative(process.cwd(), root) || "."}.`
  );
  process.exit(1);
}
console.log(
  `E2E guard: ok (${ROWS.length} rows: ${summary}; ${specs.length} spec files${allowPlanned ? "; --allow-planned" : ""})`
);
