import { usePluginSurface } from "@/hooks/usePluginSurface";

/** Renders nothing and marks one surface reachable for as long as it is mounted. */
export function PluginSurface({ pluginId, surface }: { pluginId: string; surface: string }) {
  usePluginSurface(pluginId, surface);
  return null;
}
