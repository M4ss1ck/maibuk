/**
 * One declared Settings row's live body (#450): the Plugin's own Remote UI,
 * mounted where the #437 placeholder field used to sit. It rides the same lazy
 * boundary a Plugin page uses, so Remote DOM stays out of the Settings chunk,
 * and it marks the row reachable so an on-demand Plugin warm-starts exactly as
 * a page route does. `kind: "settingsRow"` keeps the row's Plugin-local id in
 * its own registry, so it can never collide with a page id.
 *
 * Until the Plugin accepts the mount, the body carries a Plugin loading marker,
 * so a reveal of this row (a search result, a deep link) waits for the Plugin's
 * control instead of focusing an empty row. The page bounds that wait and never
 * holds a reveal of another row for it: a hung Plugin cannot block Settings.
 */

import { Suspense, lazy } from "react";
import { usePluginSurface } from "@/hooks/usePluginSurface";

const PluginRemoteUiBoundary = lazy(() =>
  import("@/features/plugins/remote-ui").then((module) => ({
    default: module.PluginRemoteUiBoundary,
  }))
);

const LOADING = <span hidden data-settings-loading="plugin" />;

export function PluginSettingsRowBody({ pluginId, rowId }: { pluginId: string; rowId: string }) {
  usePluginSurface(pluginId, `settingsRow:${rowId}`);
  return (
    <Suspense fallback={LOADING}>
      <PluginRemoteUiBoundary
        pluginId={pluginId}
        pageId={rowId}
        kind="settingsRow"
        pending={LOADING}
      />
    </Suspense>
  );
}
