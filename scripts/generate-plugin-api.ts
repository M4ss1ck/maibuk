// Regenerate: pnpm generate:plugin-api  (after changing api-table.ts)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderPluginApiDocs, renderPluginApiTypes } from "@/features/plugins/api-codegen";
import { PLUGIN_API_TABLE } from "@/features/plugins/api-table";

const root = join(import.meta.dirname, "..");
const outputs = {
  "src/plugin-sdk/api.generated.ts": renderPluginApiTypes(PLUGIN_API_TABLE),
  "docs/plugins/api-reference.md": renderPluginApiDocs(PLUGIN_API_TABLE),
};
for (const [path, text] of Object.entries(outputs)) {
  const out = join(root, path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${path}`);
}
