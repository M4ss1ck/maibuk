import { useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ToolbarButton } from "@/components/editor/ToolbarButton";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import { pluginCommandId, runPluginCommand } from "@/features/plugins/commands";
import { currentUILanguage, getPluginCommand } from "@/features/plugins/contributions-registry";
import { resolvePluginTarget } from "@/features/plugins/target-context";
import {
  isToolbarPressed,
  subscribeToolbarPressed,
  toolbarPressedRevision,
} from "@/features/plugins/toolbar-pressed";
import { registeredToolbarButtons } from "@/features/settings/toolbar-config";
import type { PluginToolbarButtonId } from "@/features/settings/toolbar-config";
import {
  useInstalledPluginLifecycle,
  usePluginLifecycleRevision,
  usePluginSurface,
} from "@/hooks/usePluginSurface";
import { usePluginItemContext } from "@/hooks/usePluginItemContext";
import { useToolbarRegistryRevision } from "@/hooks/useToolbarRegistryRevision";
import { commandLabel } from "@/lib/shortcut-registry";

/**
 * One Plugin toolbar button: joined to the existing toolbar logic (ordering,
 * visibility, the selection toolbar) and named by its Command's label and
 * tooltip. It is disabled until its Plugin is ready, and mounted means its
 * Plugin's toolbar surface is reachable (#401).
 *
 * A Command with `targets` acts on the item the author is in (a Chapter in the
 * editor, an open Note or Canvas), resolved from the same stores the Item Menu
 * path uses (#446). It stays visible for discovery and is disabled when no
 * declared kind is in context, rather than acting on a guessed target (#395).
 *
 * A Toggle Button (`toggle: true` in the manifest) shows on only while its
 * Plugin is ready and has set it on with `toolbar.setPressed`. Any other button
 * passes no pressed state, so it renders without `aria-pressed`.
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
  const itemContext = usePluginItemContext();
  const itemContextRef = useRef(itemContext);
  itemContextRef.current = itemContext;
  useSyncExternalStore(subscribeToolbarPressed, toolbarPressedRevision);

  if (button === undefined || button.command === undefined) return null;
  const commandId = pluginCommandId(button.pluginId, button.command);
  const label = commandLabel(commandId, t, currentUILanguage());
  const ready = lifecycle?.state(button.pluginId)?.status === "ready";
  const isActive = button.toggle
    ? ready && isToolbarPressed(button.pluginId, button.localId)
    : undefined;
  const targets = getPluginCommand(button.pluginId, button.command)?.targets;
  const hasTargets = (targets?.length ?? 0) > 0;
  const target = hasTargets && targets !== undefined ? resolvePluginTarget(targets, itemContext) : null;
  const icon = iconSize === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <ToolbarButton
      label={label}
      shortcut={commandId}
      disabled={!ready || (hasTargets && target === null)}
      isActive={isActive}
      onClick={() => {
        if (!lifecycle) return;
        // Captured now, at invocation: a target that vanished since the last
        // render never runs, and the one captured is never redirected later.
        const live =
          hasTargets && targets !== undefined
            ? resolvePluginTarget(targets, itemContextRef.current)
            : null;
        if (hasTargets && live === null) return;
        void runPluginCommand(
          lifecycle,
          button.pluginId,
          button.command as string,
          live !== null ? { target: live } : {}
        );
      }}
    >
      <PluginIcon icon={button.icon} className={icon} />
    </ToolbarButton>
  );
}
