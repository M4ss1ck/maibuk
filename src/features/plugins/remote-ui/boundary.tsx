/**
 * The Plugin page's Remote UI mount: it owns the receiver, renders the host
 * surface, and stops the Plugin with `remote-ui-limit` when the connection
 * refuses a declaration or the renderer throws. `PluginPage` imports it lazily,
 * so Remote DOM never reaches the entry chunk.
 *
 * Each `PluginRuntime` object is one run: it gets its own connection and error
 * boundary, keyed so a restarted Plugin (a fresh runtime) remounts everything.
 */

import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
} from "@/hooks/usePluginSurface";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";

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
  onStop,
}: {
  runtime: PluginRuntime;
  pageId: string;
  onStop: () => void;
}) {
  const { t } = useTranslation();
  const { ui, failed } = usePluginRemoteUi(runtime, pageId, onStop);
  if (failed) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {t("plugins.ui.couldNotDisplay")}
      </p>
    );
  }
  return ui && <PluginRemoteUiSurface ui={ui} onError={onStop} />;
}

export function PluginRemoteUiBoundary({
  pluginId,
  pageId,
}: {
  pluginId: string;
  pageId: string;
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
  if (runtime === null || (status !== "ready" && status !== "unavailable")) return null;
  return <PluginRemoteUiRun key={runKey(runtime)} runtime={runtime} pageId={pageId} onStop={stop} />;
}
