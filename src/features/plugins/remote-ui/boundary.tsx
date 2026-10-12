/**
 * The Plugin page's Remote UI mount: it owns the receiver, renders the host
 * surface, and stops the Plugin with `remote-ui-limit` when the connection
 * refuses a declaration or the renderer throws. `PluginPage` imports it lazily,
 * so Remote DOM never reaches the entry chunk.
 */

import { useCallback, useRef } from "react";
import { useInstalledPluginLifecycle } from "@/hooks/usePluginSurface";
import type { PluginLifecycle } from "@/features/plugins/types";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";

/**
 * Stops a Plugin whose remote UI was refused, with `remote-ui-limit` (#436):
 * the lifecycle toasts the reason and applies the restart policy.
 */
export function stopRemoteUi(lifecycle: PluginLifecycle | null, pluginId: string): void {
  lifecycle?.stop(pluginId, "remote-ui-limit");
}

export function PluginRemoteUiBoundary({ pluginId }: { pluginId: string }) {
  const lifecycle = useInstalledPluginLifecycle();
  const lifecycleRef = useRef(lifecycle);
  lifecycleRef.current = lifecycle;

  const stop = useCallback(() => {
    stopRemoteUi(lifecycleRef.current, pluginId);
  }, [pluginId]);

  const ui = usePluginRemoteUi(stop);
  if (ui === null) return null;
  return <PluginRemoteUiSurface ui={ui} onError={stop} />;
}
