import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { ItemAction } from "@/components/ui";
import { runPluginCommand, type PluginItemTarget } from "@/features/plugins/commands";
import {
  currentUILanguage,
  getPluginItemMenuEntries,
  onPluginContributionsChange,
  type PluginTarget,
} from "@/features/plugins/contributions";
import { useInstalledPluginLifecycle, usePluginLifecycleRevision } from "@/hooks/usePluginSurface";
import { commandLabel } from "@/lib/shortcut-registry";

/**
 * Builds the Plugin Item Menu entries for one item kind. The returned factory
 * takes the item being acted on, so a Command invoked from the menu carries
 * its item as the target; it is disabled until the owning Plugin is ready.
 * Maibuk's own actions come first, so callers append these.
 */
export function usePluginItemMenuActions(
  kind: PluginTarget
): (target: PluginItemTarget) => ItemAction[] {
  const { t } = useTranslation();
  const lifecycle = useInstalledPluginLifecycle();
  const lifecycleRevision = usePluginLifecycleRevision(lifecycle);
  const getSnapshot = useCallback(() => getPluginItemMenuEntries(kind), [kind]);
  const entries = useSyncExternalStore(onPluginContributionsChange, getSnapshot, getSnapshot);
  const language = currentUILanguage();

  return useCallback(
    (target: PluginItemTarget): ItemAction[] =>
      entries.map((entry) => ({
        id: entry.commandId,
        label: commandLabel(entry.commandId, t, language),
        commandId: entry.commandId,
        isDisabled: lifecycle?.state(entry.pluginId)?.status !== "ready",
        onAction: () => {
          if (lifecycle) {
            void runPluginCommand(lifecycle, entry.pluginId, entry.localId, { target });
          }
        },
      })),
    [entries, lifecycle, lifecycleRevision, language, t]
  );
}
