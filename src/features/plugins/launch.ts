/**
 * The launch scan: which approved Plugins the Plugin Directory holds, each
 * with its manifest parsed and nothing else. No frame and no Worker is created
 * here; the lifecycle (#436) decides what starts and when, so on-demand
 * Plugins never start at launch. With no approvals this never touches the
 * Plugin Directory.
 */

import { listPluginApprovals } from "@/features/plugins/approvals";
import { readPluginManifest } from "@/features/plugins/runtime";
import type {
  InstalledPlugin,
  PluginLaunchRefusal,
  PluginScanOptions,
  PluginScanResult,
} from "@/features/plugins/types";
import { getPluginDirectory } from "@/lib/platform";

export async function scanApprovedPlugins(
  options: PluginScanOptions = {}
): Promise<PluginScanResult> {
  const approvals = listPluginApprovals();
  if (approvals.length === 0) return { plugins: [], refusals: [] };

  const directory = options.directory ?? (await getPluginDirectory());
  const folders = new Set(await directory.listFolders());
  const plugins: InstalledPlugin[] = [];
  const refusals: PluginLaunchRefusal[] = [];

  for (const approval of approvals) {
    if (!folders.has(approval.pluginId)) continue;
    const folder = await directory.readFolder(approval.pluginId);
    if (!folder) continue;
    const manifest = readPluginManifest(folder);
    if (!manifest.ok) {
      refusals.push({
        pluginId: approval.pluginId,
        refusal: { code: "manifest-invalid", problems: manifest.problems },
      });
      continue;
    }
    plugins.push({ pluginId: approval.pluginId, approval, folder, manifest: manifest.manifest });
  }

  return { plugins, refusals };
}
