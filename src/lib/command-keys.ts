import { useMemo } from "react";
import { isMac } from "@/lib/platform/detect";
import { IS_WEB } from "@/lib/platform/target";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { type CommandId, type Shortcut } from "@/lib/shortcut-registry";
import {
  formatShortcut,
  isSingleKey,
  shortcutKey,
  type FormattedShortcut,
} from "@/lib/shortcut-keys";
import { effectiveShortcuts, isFixedShortcut, type ShortcutSettings } from "@/lib/shortcut-resolve";

/**
 * The Shortcuts that actually fire for a Command: its effective Shortcuts
 * minus editable single-key ones while Single-key Shortcuts are off.
 */
export function liveShortcuts(
  id: CommandId,
  settings: ShortcutSettings,
  web: boolean = IS_WEB
): Shortcut[] {
  const shortcuts = effectiveShortcuts(id, settings.custom, web);
  if (settings.singleKeyEnabled) return shortcuts;
  return shortcuts.filter((shortcut) => isFixedShortcut(id, shortcut) || !isSingleKey(shortcut));
}

/** Read outside React, at the moment a key is pressed or a menu opens. */
export function getLiveShortcuts(id: CommandId): Shortcut[] {
  return liveShortcuts(id, useShortcutSettingsStore.getState().shortcuts);
}

/** The live Shortcuts of a Command, re-rendering when the author changes them. */
export function useCommandKeys(id: CommandId): Shortcut[] {
  const settings = useShortcutSettingsStore((state) => state.shortcuts);
  return useMemo(() => liveShortcuts(id, settings), [id, settings]);
}

/** The first live Shortcut, formatted for a hint; null when the Command has none. */
export function useCommandHint(id: CommandId | undefined): {
  formatted: FormattedShortcut;
  shortcut: Shortcut;
} | null {
  const settings = useShortcutSettingsStore((state) => state.shortcuts);
  return useMemo(() => {
    if (!id) return null;
    const [first] = liveShortcuts(id, settings);
    return first ? { formatted: formatShortcut(first, isMac()), shortcut: first } : null;
  }, [id, settings]);
}

export function sameShortcut(a: Shortcut, b: Shortcut): boolean {
  return shortcutKey(a) === shortcutKey(b);
}
