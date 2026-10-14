/**
 * One declared Settings row's live body (#450): the Plugin's own Remote UI,
 * mounted where the #437 placeholder field used to sit. It rides the same lazy
 * boundary a Plugin page uses, so Remote DOM stays out of the Settings chunk,
 * and it marks the row reachable so an on-demand Plugin warm-starts exactly as
 * a page route does. `kind: "settingsRow"` keeps the row's Plugin-local id in
 * its own registry, so it can never collide with a page id.
 */

import { Suspense, lazy } from "react";
import { usePluginSurface } from "@/hooks/usePluginSurface";

const PluginRemoteUiBoundary = lazy(() =>
  import("@/features/plugins/remote-ui").then((module) => ({
    default: module.PluginRemoteUiBoundary,
  }))
);

export function PluginSettingsRowBody({ pluginId, rowId }: { pluginId: string; rowId: string }) {
  usePluginSurface(pluginId, `settingsRow:${rowId}`);
  return (
    <Suspense fallback={null}>
      <PluginRemoteUiBoundary pluginId={pluginId} pageId={rowId} kind="settingsRow" />
    </Suspense>
  );
}
