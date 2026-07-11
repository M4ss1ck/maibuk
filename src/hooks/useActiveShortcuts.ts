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

  return useMemo(() => {
    const ids: ShortcutId[] = [
      "global.gotoProjects",
      "global.gotoNotes",
      "global.gotoCanvas",
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
      ids.push(
        "home.newBook",
        "home.jumpBooks",
        "home.moveSelection",
        "home.openSelected",
      );
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
      );
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
        "canvas.lock",
      );
    }

    if (/^\/book\/[^/]+\/cover$/.test(location.pathname)) {
      ids.push("cover.save", "cover.delete");
    }

    return ids.map((id) => item(id, t));
  }, [location.pathname, t]);
}
