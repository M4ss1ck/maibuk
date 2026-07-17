import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { IS_TAURI } from "@/lib/platform";
import {
  SHORTCUTS,
  formatKeys,
  type FormattedShortcut,
  type ShortcutId,
} from "@/lib/shortcut-registry";
import { useModalStore } from "@/components/ui/modal-store";

export interface ShortcutItem {
  id: ShortcutId;
  label: string;
  formatted: FormattedShortcut;
}

function item(id: ShortcutId, t: TFunction): ShortcutItem {
  const def = SHORTCUTS[id];
  return { id, label: t(def.labelKey), formatted: formatKeys(def) };
}

export function useActiveShortcuts(): ShortcutItem[] {
  const { t } = useTranslation();
  const location = useLocation();
  const modalOpen = useModalStore((s) => s.openCount > 0);

  return useMemo(() => {
    if (modalOpen) return [];

    const ids: ShortcutId[] = [
      "global.gotoProjects",
      "global.gotoNotes",
      "global.gotoCanvas",
      "global.gotoEphemeral",
      "global.gotoMetrics",
      "global.gotoSettings",
      "global.toggleTheme",
      "global.toggleShortcutHints",
      "global.syncNow",
      "global.showHelp",
    ];

    if (IS_TAURI) {
      ids.push("global.toggleAlwaysOnTop");
    }

    if (location.pathname === "/") {
      ids.push("home.newBook", "home.jumpBooks", "home.moveSelection", "home.openSelected");
    }

    if (/^\/book\/[^/]+$/.test(location.pathname)) {
      ids.push(
        "editor.save",
        "editor.saveVersion",
        "editor.versionHistory",
        "editor.focusMode",
        "editor.toggleSidebar",
        "editor.back",
        "editor.zoomIn",
        "editor.zoomOut",
        "editor.zoomReset",
        "editor.toolbarSettings",
        "editor.dictionary",
        "editor.insertSymbol"
      );
    }

    if (location.pathname === "/ephemeral") {
      ids.push("editor.dictionary", "editor.insertSymbol");
    }

    if (/^\/canvas\/[^/]+$/.test(location.pathname)) {
      ids.push(
        "canvas.toolSelect",
        "canvas.toolPen",
        "canvas.toolEraser",
        "canvas.addTextNode",
        "canvas.addNoteRef",
        "canvas.zoomIn",
        "canvas.zoomOut",
        "canvas.fitView",
        "canvas.lock"
      );
    }

    if (/^\/book\/[^/]+\/cover$/.test(location.pathname)) {
      ids.push("cover.save", "cover.delete");
    }

    return ids.map((id) => item(id, t));
  }, [location.pathname, t, modalOpen]);
}
