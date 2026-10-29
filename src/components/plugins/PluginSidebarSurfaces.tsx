import type { PluginSidebarEntryDef } from "@/features/plugins/contributions-registry";
import { usePluginSurface } from "@/hooks/usePluginSurface";

/**
 * Marks each mounted sidebar entry reachable, so an on-demand Plugin
 * warm-starts from its sidebar entry alone (a page without a sidebar entry
 * warms from its own route instead). A Plugin with `warmStart: "intent"` is
 * not warmed by this mark: its entry warms it only on hover, focus, or press
 * (`Layout`, through `intend`). Renders nothing.
 */
export function PluginSidebarSurfaces({ entries }: { entries: readonly PluginSidebarEntryDef[] }) {
  return (
    <>
      {entries.map((entry) => (
        <SidebarSurface key={entry.pageRoute} pluginId={entry.pluginId} pageId={entry.pageId} />
      ))}
    </>
  );
}

function SidebarSurface({ pluginId, pageId }: { pluginId: string; pageId: string }) {
  usePluginSurface(pluginId, `sidebar:${pageId}`);
  return null;
}
