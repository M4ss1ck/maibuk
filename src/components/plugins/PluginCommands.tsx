import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { pluginCommandBindings } from "@/features/plugins/commands";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
} from "@/hooks/usePluginSurface";
import { useShortcuts } from "@/lib/shortcuts";
import {
  ROUTE_CONTEXTS,
  commandIds,
  getCommand,
  isPluginCommandId,
  pluginIdOfCommand,
} from "@/lib/shortcut-registry";

/**
 * Wires a Plugin's Commands into the shared key handling and the Command
 * runner, and warms the Plugins whose Commands live in the current screen's
 * Shortcut Contexts. Mounted once in the app shell: it renders nothing and,
 * with no Plugins, binds nothing.
 *
 * Only the Commands whose Contexts are active here are bound, so a Plugin page
 * context stays on its page and a target Command stays behind its Item Menu.
 */
export function PluginCommands() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lifecycle = useInstalledPluginLifecycle();
  const revision = useCommandRegistryRevision();
  const lifecycleRevision = usePluginLifecycleRevision(lifecycle);

  const bindings = useMemo(() => {
    if (!lifecycle) return [];
    const active = new Set<string>(["global", ...(ROUTE_CONTEXTS[pathname] ?? [])]);
    return pluginCommandBindings(lifecycle, (route) => navigate(route)).filter((binding) =>
      getCommand(binding.id).contexts.some((context) => active.has(context))
    );
  }, [lifecycle, pathname, navigate, revision, lifecycleRevision]);

  useShortcuts(bindings);

  // A screen whose Contexts match a Plugin Command is a reachable surface: an
  // on-demand Plugin warm-starts, and a global Command makes it effectively
  // persistent (#401).
  useEffect(() => {
    if (!lifecycle) return;
    const active = new Set<string>(["global", ...(ROUTE_CONTEXTS[pathname] ?? [])]);
    const pluginIds = new Set<string>();
    for (const id of commandIds()) {
      if (!isPluginCommandId(id)) continue;
      if (!getCommand(id).contexts.some((context) => active.has(context))) continue;
      const pluginId = pluginIdOfCommand(id);
      if (pluginId !== null) pluginIds.add(pluginId);
    }
    const reached = [...pluginIds];
    for (const pluginId of reached) lifecycle.surfaceReached(pluginId, "context");
    return () => {
      for (const pluginId of reached) lifecycle.surfaceLeft(pluginId, "context");
    };
  }, [lifecycle, pathname, revision]);

  return null;
}
