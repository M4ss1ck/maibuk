/**
 * Launch-time Plugin start. With no approvals this is a no-op: no frame, no
 * Worker, no Directory scan. Approval records exist only through the install
 * and permission flow (#442) or the E2E `prepareDevice` seed until it lands;
 * a folder that changed after pinning is refused by `startPlugin`, so an
 * approved Plugin whose files moved stays off.
 */

import { listPluginApprovals } from "@/features/plugins/approvals";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { startPlugin } from "@/features/plugins/runtime";
import type {
  LaunchPluginsOptions,
  PluginLaunchRefusal,
  PluginLaunchResult,
  PluginRuntime,
} from "@/features/plugins/types";
import { getPluginDirectory } from "@/lib/platform";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";

export async function startApprovedPlugins(
  options: LaunchPluginsOptions = {}
): Promise<PluginLaunchResult> {
  const approvals = listPluginApprovals();
  if (approvals.length === 0) return { launched: [], refusals: [] };

  const directory = options.directory ?? (await getPluginDirectory());
  const folders = new Set(await directory.listFolders());
  const launched: PluginRuntime[] = [];
  const refusals: PluginLaunchRefusal[] = [];
  // A broker call that reads or writes the Library must refuse while the
  // Tutorial Library is active (ADR 0008), like every other background job.
  const isLibraryAvailable = options.isLibraryAvailable ?? (() => !isTutorialLibraryActive());

  for (const approval of approvals) {
    if (!folders.has(approval.pluginId)) continue;
    const folder = await directory.readFolder(approval.pluginId);
    if (!folder) continue;
    const result = await startPlugin({
      folder,
      pinnedHash: approval.pinnedHash,
      granted: approval.granted,
      handlers: options.handlers ?? createPluginHandlers,
      createFrame: options.createFrame,
      isLibraryAvailable,
      timeoutMs: options.timeoutMs,
    });
    if (result.ok) launched.push(result.plugin);
    else refusals.push({ pluginId: approval.pluginId, refusal: result.refusal });
  }

  for (const { pluginId, refusal } of refusals) {
    console.warn(`Plugin ${pluginId} did not start: ${refusal.code}`, refusal);
  }
  return { launched, refusals };
}
