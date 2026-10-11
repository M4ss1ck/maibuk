import { useTranslation } from "react-i18next";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { pluginCommandId, runPluginCommand } from "@/features/plugins/commands";
import { currentUILanguage } from "@/features/plugins/contributions";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import type { PluginToolbarButtonId } from "@/features/settings/toolbar-config";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
  usePluginSurface,
} from "@/hooks/usePluginSurface";
import { useToolbarRegistryRevision } from "@/hooks/useToolbarRegistryRevision";
import { commandLabel } from "@/lib/shortcut-registry";

/**
 * One Plugin toolbar button: joined to the existing toolbar logic (ordering,
 * visibility, the selection toolbar) and named by its Command's label and
 * tooltip. It is disabled until its Plugin is ready, and mounted means its
 * Plugin's toolbar surface is reachable (#401).
 */
export function PluginToolbarButton({
  id,
  iconSize,
}: {
  id: PluginToolbarButtonId;
  iconSize: "sm" | "md";
}) {
  const { t } = useTranslation();
  useToolbarRegistryRevision();
  const lifecycle = useInstalledPluginLifecycle();
  usePluginLifecycleRevision(lifecycle);
  const button = registeredToolbarButtons().find((candidate) => candidate.id === id);
  usePluginSurface(button?.pluginId, `toolbar:${id}`);

  if (button === undefined || button.command === undefined) return null;
  const commandId = pluginCommandId(button.pluginId, button.command);
  const label = commandLabel(commandId, t, currentUILanguage());
  const ready = lifecycle?.state(button.pluginId)?.status === "ready";
  const icon = iconSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <ToolbarButton
      label={label}
      shortcut={commandId}
      disabled={!ready}
      onClick={() => {
        if (lifecycle) void runPluginCommand(lifecycle, button.pluginId, button.command as string);
      }}
    >
      <PluginIcon icon={button.icon} className={icon} />
    </ToolbarButton>
  );
}
