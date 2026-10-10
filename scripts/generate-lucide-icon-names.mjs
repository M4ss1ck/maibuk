// Regenerate: pnpm generate:plugin-manifest  (after bumping lucide-react)
// Plain Node: the Lucide package exposes its dynamic-import map only as an ESM
// file, which tsx's CJS interop misreads.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const { default: dynamicIconImports } = await import("lucide-react/dist/esm/dynamicIconImports.js");

const out = join(import.meta.dirname, "../src/features/plugins/lucide-icon-names.json");
const names = Object.keys(dynamicIconImports).sort();
writeFileSync(out, `${JSON.stringify(names, null, 2)}\n`);
console.log(`wrote ${names.length} Lucide icon names to ${out}`);
