import { useEffect, useMemo, useRef } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { pluginCommandBindings } from "@/features/plugins/commands";
import { setPluginNavigator } from "@/features/plugins/navigation";
import { useCommandRegistryRevision } from "@/hooks/useCommandRegistryRevision";
import { useInstalledPluginLifecycle, usePluginLifecycleRevision } from "@/hooks/usePluginSurface";
import { usePluginItemContext } from "@/hooks/usePluginItemContext";
import { useShortcuts } from "@/lib/shortcuts";
import type { PluginLifecycle } from "@/features/plugins/types";
import {
  ROUTE_CONTEXTS,
  commandIds,
  getCommand,
  isPluginCommandId,
  pluginIdOfCommand,
} from "@/lib/shortcut-registry";

/**
 * The Shortcut Contexts active for a live pathname. `ROUTE_CONTEXTS` is keyed
 * by route patterns (`/book/:bookId`), so the pathname is matched against each
 * pattern with the router's own matcher instead of indexing by the live path.
 */
export function activeRouteContexts(pathname: string): Set<string> {
  const active = new Set<string>(["global"]);
  for (const [pattern, contexts] of Object.entries(ROUTE_CONTEXTS)) {
    if (matchPath({ path: pattern, end: true }, pathname) !== null) {
      for (const context of contexts) active.add(context);
    }
  }
  return active;
}

/**
 * The Plugins whose Commands live in the active Contexts, in registry order.
 */
function pluginsOfActiveContexts(active: ReadonlySet<string>): string[] {
  const pluginIds = new Set<string>();
  for (const id of commandIds()) {
    if (!isPluginCommandId(id)) continue;
    if (!getCommand(id).contexts.some((context) => active.has(context))) continue;
    const pluginId = pluginIdOfCommand(id);
    if (pluginId !== null) pluginIds.add(pluginId);
  }
  return [...pluginIds];
}

/**
 * Wires a Plugin's Commands into the shared key handling and the Command
 * runner, and warms the Plugins whose Commands live in the current screen's
 * Shortcut Contexts. Mounted once in the app shell: it renders nothing and,
 * with no Plugins, binds nothing.
 *
 * Only the Commands whose Contexts are active here are bound, so a Plugin page
 * context stays on its page. A target Command that declares a screen Context is
 * bound here and runs against the item the resolver finds the author in; one
 * whose Contexts are all item Contexts keeps its focused row's binding through
 * `useItemCommands` instead. One key press runs the Command once even when both
 * bindings match it (#446).
 */
export function PluginCommands() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const lifecycle = useInstalledPluginLifecycle();
  const revision = useCommandRegistryRevision();
  const lifecycleRevision = usePluginLifecycleRevision(lifecycle);
  const itemContext = usePluginItemContext();
  // The bindings are rebuilt when the context changes (so enablement tracks the
  // open Chapter); the getter reads the latest one at trigger time.
  const itemContextRef = useRef(itemContext);
  itemContextRef.current = itemContext;

  const bindings = useMemo(() => {
    if (!lifecycle) return [];
    const active = activeRouteContexts(pathname);
    return pluginCommandBindings(lifecycle, (route) => navigate(route), () => itemContextRef.current).filter(
      (binding) => getCommand(binding.id).contexts.some((context) => active.has(context))
    );
  }, [lifecycle, pathname, navigate, revision, lifecycleRevision, itemContext]);

  useShortcuts(bindings);

  // `navigation.openEntity` opens entities through the same navigator the
  // Plugin Commands use, so a Plugin page cannot move the app without the
  // app shell's own router.
  useEffect(() => setPluginNavigator((to, options) => navigate(to, options)), [navigate]);

  // A screen whose Contexts match a Plugin Command is a reachable surface: an
  // on-demand Plugin warm-starts, and a global Command makes it effectively
  // persistent (#401). Membership is diffed, so navigating inside routes that
  // keep the Plugin reachable re-arms nothing (retried `surfaceReached` calls
  // keep restarting the idle window). The effect below has no cleanup —
  // leaving depends on the set this lifecycle reached, which only the
  // lifecycle change and the unmount undo (the second effect, which owns the
  // same lifecycle).
  const reached = useRef<{ owner: PluginLifecycle | null; ids: string[] }>({
    owner: null,
    ids: [],
  });
  useEffect(() => {
    if (!lifecycle) return;
    if (reached.current.owner !== lifecycle) reached.current = { owner: lifecycle, ids: [] };
    const current = pluginsOfActiveContexts(activeRouteContexts(pathname));
    for (const pluginId of reached.current.ids) {
      if (!current.includes(pluginId)) lifecycle.surfaceLeft(pluginId, "context");
    }
    for (const pluginId of current) {
      if (!reached.current.ids.includes(pluginId)) lifecycle.surfaceReached(pluginId, "context");
    }
    reached.current = { owner: lifecycle, ids: current };
  }, [lifecycle, pathname, revision]);

  // Teardown bound to the lifecycle: every id reached on THIS lifecycle is
  // left when it changes or the component unmounts, before the diff above
  // re-reaches the current membership on a new lifecycle.
  useEffect(
    () => () => {
      if (!lifecycle) return;
      const { owner, ids } = reached.current;
      if (owner !== lifecycle) return;
      for (const pluginId of ids) lifecycle.surfaceLeft(pluginId, "context");
      reached.current = { owner, ids: [] };
    },
    [lifecycle]
  );

  return null;
}
