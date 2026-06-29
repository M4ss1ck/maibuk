import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IS_TAURI } from "@/lib/platform";

export interface ShortcutItem {
  id: string;
  label: string;
  keys: string[];
}

export function useActiveShortcuts(): ShortcutItem[] {
  const { t } = useTranslation();
  const location = useLocation();

  return useMemo(() => {
    const list: ShortcutItem[] = [
      { id: "global.gotoProjects", label: t("shortcuts.gotoProjects"), keys: ["g", "p"] },
      { id: "global.gotoNotes", label: t("shortcuts.gotoNotes"), keys: ["g", "n"] },
      { id: "global.gotoCanvas", label: t("shortcuts.gotoCanvas"), keys: ["g", "c"] },
      { id: "global.gotoMetrics", label: t("shortcuts.gotoMetrics"), keys: ["g", "m"] },
      { id: "global.gotoSettings", label: t("shortcuts.gotoSettings"), keys: ["g", "s"] },
      { id: "global.toggleTheme", label: t("shortcuts.toggleTheme"), keys: ["g", "t"] },
      {
        id: "global.toggleShortcutHints",
        label: t("shortcuts.toggleShortcutHints"),
        keys: ["g", "h"],
      },
      { id: "global.syncNow", label: t("shortcuts.syncNow"), keys: ["Ctrl+Shift+Y"] },
      { id: "global.showHelp", label: t("shortcuts.showHelp"), keys: ["?"] },
    ];
    if (IS_TAURI) {
      list.push({
        id: "global.toggleAlwaysOnTop",
        label: t("shortcuts.toggleAlwaysOnTop"),
        keys: ["Ctrl+Shift+P"],
      });
    }

    if (location.pathname === "/") {
      list.push(
        { id: "home.newBook", label: t("shortcuts.newBook"), keys: ["Ctrl+N"] },
        { id: "home.jumpBooks", label: t("shortcuts.jumpBooks"), keys: ["1-9"] },
        { id: "home.moveSelection", label: t("shortcuts.moveSelection"), keys: ["↑/↓", "j/k"] },
        { id: "home.openSelected", label: t("shortcuts.openSelected"), keys: ["Enter"] }
      );
    }

    if (/^\/book\/[^/]+$/.test(location.pathname)) {
      list.push(
        { id: "editor.save", label: t("shortcuts.save"), keys: ["Ctrl+S"] },
        { id: "editor.saveVersion", label: t("shortcuts.saveVersion"), keys: ["Ctrl+Alt+S"] },
        { id: "editor.versionHistory", label: t("shortcuts.versionHistory"), keys: ["g v"] },
        { id: "editor.focusMode", label: t("shortcuts.toggleFocusMode"), keys: ["F11"] },
        { id: "editor.toggleSidebar", label: t("shortcuts.toggleSidebar"), keys: ["Ctrl+\\"] },
        { id: "editor.back", label: t("shortcuts.backFromEditor"), keys: ["Backspace"] },
        { id: "editor.zoomIn", label: t("shortcuts.zoomIn"), keys: ["Ctrl++"] },
        { id: "editor.zoomOut", label: t("shortcuts.zoomOut"), keys: ["Ctrl+-"] },
        { id: "editor.zoomReset", label: t("shortcuts.zoomReset"), keys: ["Ctrl+0"] }
      );
    }

    if (/^\/canvas\/[^/]+$/.test(location.pathname)) {
      list.push(
        { id: "canvas.toolSelect", label: t("canvas.toolSelect"), keys: ["V"] },
        { id: "canvas.toolPen", label: t("canvas.toolPen"), keys: ["P"] },
        { id: "canvas.toolEraser", label: t("canvas.toolEraser"), keys: ["E"] },
        { id: "canvas.addTextNode", label: t("canvas.addTextNode"), keys: ["T"] },
        { id: "canvas.addNoteRef", label: t("canvas.addNoteRef"), keys: ["N"] },
        { id: "canvas.zoomIn", label: t("canvas.zoomIn"), keys: ["Ctrl++"] },
        { id: "canvas.zoomOut", label: t("canvas.zoomOut"), keys: ["Ctrl+-"] },
        { id: "canvas.fitView", label: t("canvas.fitView"), keys: ["Shift+1"] },
        { id: "canvas.lock", label: t("canvas.lockInteractivity"), keys: ["L"] }
      );
    }

    if (/^\/book\/[^/]+\/cover$/.test(location.pathname)) {
      list.push(
        { id: "cover.save", label: t("shortcuts.save"), keys: ["Ctrl+S"] },
        { id: "cover.delete", label: t("shortcuts.deleteSelection"), keys: ["Delete"] }
      );
    }

    return list;
  }, [location.pathname, t]);
}