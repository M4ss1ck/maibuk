import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { PluginFrameSurface } from "@/components/plugins/PluginFrame";
import { PluginStoppedPanel } from "@/components/plugins/PluginStoppedPanel";
import { pluginPageCommandBindings } from "@/features/plugins/commands";
import { getPluginPage, getPluginSidebarEntries } from "@/features/plugins/contributions-registry";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import {
  useInstalledPluginLifecycle,
  usePluginLaunchScanned,
  usePluginLifecycleRevision,
  usePluginSurface,
  useStoppedPlugin,
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
 * the Remote UI host renderer, which draws whatever tree the Plugin sends, or
 * its Frame; a Stopped Plugin shows why instead, with Try again (#618).
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
  const stopped = useStoppedPlugin(pluginId);
  const status = lifecycle?.state(pluginId)?.status ?? null;
  // An explicit start from the panel: the panel stays, reading "Starting…",
  // until the Plugin is ready or stops again.
  const [retrying, setRetrying] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tryAgain = () => {
    if (!lifecycle) return;
    setRetrying(true);
    void lifecycle.start(pluginId, "restart").finally(() => setRetrying(false));
  };

  const bindings = useMemo(
    () => (lifecycle ? pluginPageCommandBindings(lifecycle, pluginId, pageId) : []),
    [lifecycle, pluginId, pageId, revision, lifecycleRevision, scanned]
  );
  useShortcuts(bindings);

  // A Plugin the launch scan refused registered no page; the sidebar entry
  // the last launch saved still names it, so its page can say why (#618).
  const savedEntry =
    page === undefined && stopped !== null
      ? getPluginSidebarEntries().find(
          (entry) => entry.pluginId === pluginId && entry.pageId === pageId
        )
      : undefined;
  const title = page?.title ?? savedEntry?.title ?? t("plugins.page.notFoundTitle");
  const name = page?.displayName ?? savedEntry?.displayName ?? pluginId;
  const showPanel =
    scanned && (page !== undefined || savedEntry !== undefined) && (stopped !== null || retrying);
  // When the panel goes (the retried Plugin is ready), its focused button goes
  // with it: keep focus on the page instead of dropping it to the document.
  const hadPanel = useRef(showPanel);
  useEffect(() => {
    if (hadPanel.current && !showPanel && document.activeElement === document.body) {
      headingRef.current?.focus();
    }
    hadPanel.current = showPanel;
  }, [showPanel]);

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
        <p className="mt-2 text-sm text-muted-foreground">{t("plugins.page.loadingDescription")}</p>
      </div>
    );
  }

  // A whole-page Frame fills the page and scrolls inside itself, so the page
  // around it never scrolls; a page that draws its own heading keeps the title
  // for screen readers and route focus only.
  const isFrame = page?.frame !== undefined && !showPanel;
  const hideTitle = page?.hideTitle === true && !showPanel;
  return (
    <div
      className={
        isFrame
          ? `flex h-full min-h-0 flex-col overflow-hidden px-4 sm:px-6 ${hideTitle ? "py-4" : "py-6"}`
          : `h-full overflow-y-auto px-4 sm:px-6 ${hideTitle ? "py-4" : "py-6"}`
      }
    >
      <h1
        ref={headingRef}
        tabIndex={-1}
        data-route-heading
        className={
          hideTitle ? "sr-only" : "text-xl font-semibold tracking-tight mb-6 outline-none shrink-0"
        }
      >
        {title}
      </h1>
      {status === "unavailable" && !showPanel && (
        <p role="status" className="mb-4 shrink-0 text-sm text-muted-foreground">
          {t("plugins.stoppedPanel.notResponding", { name })}
        </p>
      )}
      {showPanel ? (
        <PluginStoppedPanel
          pluginId={pluginId}
          name={name}
          stopped={retrying && status === "starting" ? null : stopped}
          starting={retrying}
          onTryAgain={tryAgain}
        />
      ) : page === undefined ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("plugins.page.notFoundDescription")}
        </p>
      ) : page.frame !== undefined ? (
        // A page whose contribution declares `frame` is a whole-page Frame
        // (#454, D2): the sandboxed surface replaces the Remote UI tree.
        <PluginFrameSurface
          pluginId={pluginId}
          src={page.frame}
          title={page.title}
          variant="page"
        />
      ) : (
        <Suspense fallback={null}>
          <PluginRemoteUiBoundary pluginId={pluginId} pageId={pageId} />
        </Suspense>
      )}
    </div>
  );
}
