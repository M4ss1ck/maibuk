// `tsx e2e/guards/run.ts [--allow-planned]`: the pre-run guard. Reads the
// matrix, CONTEXT.md, the shortcut registry, App.tsx routes and every e2e
// file, and exits 1 with one line per problem. `pnpm test:e2e` runs it before
// Playwright and never passes --allow-planned.

import { relative, resolve } from "node:path";
import { ROWS } from "../coverage-matrix";
import { checkCoverage } from "./coverage";
import { collectGuardInputs } from "./inputs";

const root = resolve(import.meta.dirname, "../..");
const allowPlanned = process.argv.includes("--allow-planned");

const inputs = collectGuardInputs(root);

const problems = checkCoverage({ ...inputs, allowPlanned });

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
  `E2E guard: ok (${ROWS.length} rows: ${summary}; ${inputs.specs.length} spec files${allowPlanned ? "; --allow-planned" : ""})`
);
