import { Suspense, lazy, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { pluginPageCommandBindings } from "@/features/plugins/commands";
import { getPluginPage } from "@/features/plugins/contributions-registry";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import {
  useInstalledPluginLifecycle,
  usePluginLaunchScanned,
  usePluginLifecycleRevision,
  usePluginSurface,
} from "@/hooks/usePluginSurface";
import { useShortcuts } from "@/lib/shortcuts";

/**
 * The Remote UI host renderer is only needed when a Plugin page opens, so it is
 * split out of the entry chunk (#438).
 */
const PluginRemoteUiBoundary = lazy(() =>
  import("@/features/plugins/remote-ui").then((module) => ({
    default: module.PluginRemoteUiBoundary,
  }))
);

/**
 * The one route a Plugin's page opens at. It is its own Shortcut Context, so
 * the Commands declared for this page bind here and nowhere else, and mounting
 * it marks the page reachable (an on-demand Plugin warm-starts). The body is
 * the Remote UI host renderer, which draws whatever tree the Plugin sends.
 */
export function PluginPage() {
  const { t } = useTranslation();
  const { pluginId = "", pageId = "" } = useParams();
  const lifecycle = useInstalledPluginLifecycle();
  const revision = useCommandRegistryRevision();
  const lifecycleRevision = usePluginLifecycleRevision(lifecycle);
  const scanned = usePluginLaunchScanned(lifecycle);
  const page = getPluginPage(pluginId, pageId);
  usePluginSurface(pluginId, `page:${pageId}`, page !== undefined);

  const bindings = useMemo(
    () => (lifecycle ? pluginPageCommandBindings(lifecycle, pluginId, pageId) : []),
    [lifecycle, pluginId, pageId, revision, lifecycleRevision, scanned]
  );
  useShortcuts(bindings);

  // While the lifecycle has not finished its launch scan (it installs in idle
  // time after the first render, and the scan waits for the Library, the
  // launch Auto Sync, and the launch Backup), the contributions registry is
  // still empty: a missing page means "still loading", not "not installed".
  if (lifecycle === null || !scanned) {
    return (
      <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
        <h1 data-route-heading className="text-xl font-semibold tracking-tight">
          {t("plugins.page.loadingTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("plugins.page.loadingDescription")}
        </p>
      </div>
    );
  }

  const title = page?.title ?? t("plugins.page.notFoundTitle");

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <h1 data-route-heading className="text-xl font-semibold tracking-tight">
        {title}
      </h1>
      {page === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("plugins.page.notFoundDescription")}</p>
      ) : (
        <Suspense fallback={null}>
          <PluginRemoteUiBoundary pluginId={pluginId} />
        </Suspense>
      )}
    </div>
  );
}
