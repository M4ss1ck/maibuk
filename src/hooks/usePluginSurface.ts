import { useEffect, useState } from "react";
import {
  getPluginLifecycle,
  onPluginLifecycleInstalled,
} from "@/features/plugins/lifecycle-instance";
import type { PluginLifecycle } from "@/features/plugins/types";

/**
 * The app's one lifecycle, re-rendering when the idle install happens. A
 * surface that mounted before the install (the sidebar, a page already on
 * screen) subscribes here instead of losing its warm-start signal.
 */
export function useInstalledPluginLifecycle(): PluginLifecycle | null {
  const [lifecycle, setLifecycle] = useState<PluginLifecycle | null>(() => getPluginLifecycle());
  useEffect(() => onPluginLifecycleInstalled(() => setLifecycle(getPluginLifecycle())), []);
  return lifecycle;
}

/**
 * A counter that changes on every lifecycle state change, so a surface bound
 * to a Command recomputes when its Plugin reaches `ready` or stops: a binding
 * built while the Plugin was still starting is otherwise frozen as disabled.
 */
export function usePluginLifecycleRevision(lifecycle: PluginLifecycle | null): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!lifecycle) return;
    return lifecycle.subscribe(() => setRevision((current) => current + 1));
  }, [lifecycle]);
  return revision;
}

/**
 * Declares that a surface is reachable while mounted: an on-demand Plugin
 * warm-starts from it and its idle window resets. Safe when there is no
 * lifecycle yet or no such Plugin; the signal is delivered once it installs.
 */
export function usePluginSurface(
  pluginId: string | null | undefined,
  surface: string,
  enabled = true
): void {
  const lifecycle = useInstalledPluginLifecycle();
  useEffect(() => {
    if (!enabled || !pluginId || !lifecycle) return;
    lifecycle.surfaceReached(pluginId, surface);
    return () => lifecycle.surfaceLeft(pluginId, surface);
  }, [lifecycle, pluginId, surface, enabled]);
}
