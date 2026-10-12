// Regenerate: pnpm generate:plugin-ui  (after changing src/plugin-sdk/ui-table.ts)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderPluginUiTypes } from "@/features/plugins/ui-codegen";
import { PLUGIN_UI_TABLE } from "@/plugin-sdk/ui-table";

const root = join(import.meta.dirname, "..");
const outputs = {
  "src/plugin-sdk/ui.generated.ts": renderPluginUiTypes(PLUGIN_UI_TABLE),
};
for (const [path, text] of Object.entries(outputs)) {
  const out = join(root, path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`wrote ${path}`);
}
