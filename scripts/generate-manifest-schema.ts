// Regenerate: pnpm generate:plugin-manifest  (after changing manifest-schema.ts)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPluginManifestJsonSchema } from "@/features/plugins/manifest-schema";

const out = join(import.meta.dirname, "../src/features/plugins/manifest.schema.json");
const schema = buildPluginManifestJsonSchema();
writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote the Plugin manifest schema to ${out}`);
