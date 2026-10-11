import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { pluginPageCommandBindings } from "@/features/plugins/commands";
import { getPluginPage } from "@/features/plugins/contributions";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
  usePluginSurface,
} from "@/hooks/usePluginSurface";
import { useShortcuts } from "@/lib/shortcuts";

/**
 * The one route a Plugin's page opens at. It is its own Shortcut Context, so
 * the Commands declared for this page bind here and nowhere else, and mounting
 * it marks the page reachable (an on-demand Plugin warm-starts). Until the
 * Remote UI host renderer lands (#438), the page body is a placeholder; the
 * host still discovers, routes to, and announces the page.
 */
export function PluginPage() {
  const { t } = useTranslation();
  const { pluginId = "", pageId = "" } = useParams();
  const lifecycle = useInstalledPluginLifecycle();
  const revision = useCommandRegistryRevision();
  const lifecycleRevision = usePluginLifecycleRevision(lifecycle);
  const page = getPluginPage(pluginId, pageId);
  usePluginSurface(pluginId, `page:${pageId}`, page !== undefined);

  const installed = lifecycle?.installed().find((plugin) => plugin.pluginId === pluginId) ?? null;
  const bindings = useMemo(
    () => (lifecycle && installed ? pluginPageCommandBindings(lifecycle, installed, pageId) : []),
    [lifecycle, installed, pageId, revision, lifecycleRevision]
  );
  useShortcuts(bindings);

  const title = page?.title ?? t("plugins.page.notFoundTitle");

  return (
    <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
      <h1 data-route-heading className="text-xl font-semibold tracking-tight">
        {title}
      </h1>
      {page === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("plugins.page.notFoundDescription")}</p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("plugins.page.placeholderDescription", { name: page.displayName })}
        </p>
      )}
    </div>
  );
}
