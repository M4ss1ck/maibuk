/**
 * The Plugin page's Remote UI mount: it owns the receiver, renders the host
 * surface, and stops the Plugin with `remote-ui-limit` when the connection
 * refuses a declaration or the renderer throws. `PluginPage` imports it lazily,
 * so Remote DOM never reaches the entry chunk.
 *
 * Each `PluginRuntime` object is one run: it gets its own connection and error
 * boundary, keyed so a restarted Plugin (a fresh runtime) remounts everything.
 */

import { useCallback, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
} from "@/hooks/usePluginSurface";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import type { PluginUiMountKind } from "@/plugin-sdk/protocol";

/**
 * Stops a Plugin whose remote UI was refused, with `remote-ui-limit` (#436):
 * the lifecycle toasts the reason and applies the restart policy.
 */
export function stopRemoteUi(lifecycle: PluginLifecycle | null, pluginId: string): void {
  lifecycle?.stop(pluginId, "remote-ui-limit");
}

/**
 * A stable key per `PluginRuntime` object: its first run assigns the next
 * number, so a restart (a new runtime) gets a different key and remounts the
 * run instead of reusing the old connection.
 */
const runKeys = new WeakMap<PluginRuntime, number>();
let nextRunKey = 0;

function runKey(runtime: PluginRuntime): number {
  let key = runKeys.get(runtime);
  if (key === undefined) {
    nextRunKey += 1;
    key = nextRunKey;
    runKeys.set(runtime, key);
  }
  return key;
}

/** One run's host side: its remote UI and, when the mount is refused, the fallback. */
function PluginRemoteUiRun({
  runtime,
  pageId,
  kind,
  pending,
  onStop,
}: {
  runtime: PluginRuntime;
  pageId: string;
  kind: PluginUiMountKind;
  pending: ReactNode;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const { ui, mounted, failed } = usePluginRemoteUi(runtime, pageId, onStop, kind);
  if (failed) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("plugins.ui.couldNotDisplay")}
      </p>
    );
  }
  return (
    <>
      {!mounted && pending}
      {ui && <PluginRemoteUiSurface ui={ui} onError={onStop} />}
    </>
  );
}

export function PluginRemoteUiBoundary({
  pluginId,
  pageId,
  kind = "page",
  pending = null,
}: {
  pluginId: string;
  pageId: string;
  /** The registry to mount from: a page (default) or a Settings row body. */
  kind?: PluginUiMountKind;
  /** Shown while the Plugin starts and until it accepts the mount. */
  pending?: ReactNode;
}) {
  const lifecycle = useInstalledPluginLifecycle();
  // Re-render when the Plugin's state changes (start, ready, stop).
  usePluginLifecycleRevision(lifecycle);
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  const stop = useCallback(() => {
    stopRemoteUi(lifecycleRef.current, pluginId);
  }, [pluginId]);

  const runtime = lifecycle?.runtime(pluginId) ?? null;
  const status = lifecycle?.state(pluginId)?.status ?? null;
  // A mount before `ready` could reach a Plugin that has not installed its
  // handler yet; only a running or heartbeat-degraded Plugin renders.
  if (status === "starting") return pending;
  if (runtime === null || (status !== "ready" && status !== "unavailable")) return null;
  return (
    <PluginRemoteUiRun
      key={runKey(runtime)}
      runtime={runtime}
      pageId={pageId}
      kind={kind}
      pending={pending}
      onStop={stop}
    />
  );
}
