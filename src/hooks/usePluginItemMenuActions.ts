import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { ItemAction } from "@/components/ui";
import { runPluginCommand, type PluginItemTarget } from "@/features/plugins/commands";
import {
  currentUILanguage,
  getPluginItemMenuEntries,
  onPluginContributionsChange,
  type PluginTarget,
} from "@/features/plugins/contributions-registry";
import { useBookStore } from "@/features/books/store";
import { useCanvasStore } from "@/features/canvas/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import { useInstalledPluginLifecycle, usePluginLifecycleRevision } from "@/hooks/usePluginSurface";
import { commandLabel } from "@/lib/shortcut-registry";

/**
 * Whether the item the menu was opened on still exists, read live from the
 * same source that drew the row (the store, not the render's props). This is
 * the Item Menu path's re-check: a Chapter, Note, or Canvas node deleted while
 * the broker request was pending cancels instead of acting on nothing.
 */
export function pluginTargetIsLive(target: PluginItemTarget): boolean {
  switch (target.kind) {
    case "chapter":
      return useChapterStore.getState().chapters.some((chapter) => chapter.id === target.id);
    case "note":
      return useNoteStore.getState().notes.some((note) => note.id === target.id);
    case "canvasNode":
      return useCanvasStore.getState().doc.nodes.some((node) => node.id === target.id);
    case "book":
      return useBookStore.getState().books.some((book) => book.id === target.id);
    case "canvas":
      return useCanvasStore.getState().canvases.some((canvas) => canvas.id === target.id);
    // Book and Canvas-gallery rows have no Item Menu today, so this default is
    // here for future kinds: unverifiable is never blocked.
    default:
      return true;
  }
}

/**
 * Builds the Plugin Item Menu entries for one item kind. The returned factory
 * takes the item being acted on, so a Command invoked from the menu carries
 * its item as the target; it is disabled until the owning Plugin is ready.
 * `readTarget` re-reads the item from live state: the request still goes out
 * with the captured target, and it cancels instead of reporting ran when the
 * item is gone or was replaced between invocation and the broker's answer.
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
            void runPluginCommand(lifecycle, entry.pluginId, entry.localId, {
              readTarget: () => (pluginTargetIsLive(target) ? target : null),
            });
          }
        },
      })),
    [entries, lifecycle, lifecycleRevision, language, t]
  );
}
