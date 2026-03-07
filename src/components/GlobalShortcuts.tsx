import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcuts } from "../lib/shortcuts";
import { useTranslation } from "react-i18next";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";

export function GlobalShortcuts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  const activeShortcuts = useMemo(() => {
    const list: { id: string; label: string; keys: string[] }[] = [
      { id: "global.gotoProjects", label: t("shortcuts.gotoProjects"), keys: ["g", "p"] },
      { id: "global.gotoSettings", label: t("shortcuts.gotoSettings"), keys: ["g", "s"] },
      { id: "global.showHelp", label: t("shortcuts.showHelp"), keys: ["?"] },
    ];

    if (location.pathname === "/") {
      list.push(
        { id: "home.newBook", label: t("shortcuts.newBook"), keys: ["Ctrl+N"] },
        { id: "home.jumpBooks", label: t("shortcuts.jumpBooks"), keys: ["1-9"] },
        { id: "home.moveSelection", label: t("shortcuts.moveSelection"), keys: ["↑/↓", "j/k"] },
        { id: "home.openSelected", label: t("shortcuts.openSelected"), keys: ["Enter"] },
      );
    }

    if (/^\/book\/[^/]+$/.test(location.pathname)) {
      list.push(
        { id: "editor.save", label: t("shortcuts.save"), keys: ["Ctrl+S"] },
        { id: "editor.focusMode", label: t("shortcuts.toggleFocusMode"), keys: ["F11"] },
        { id: "editor.back", label: t("shortcuts.backFromEditor"), keys: ["Backspace"] },
      );
    }

    if (/^\/book\/[^/]+\/cover$/.test(location.pathname)) {
      list.push(
        { id: "cover.save", label: t("shortcuts.save"), keys: ["Ctrl+S"] },
        { id: "cover.delete", label: t("shortcuts.deleteSelection"), keys: ["Delete"] },
      );
    }

    return list;
  }, [location.pathname, t]);

  useShortcuts([
    {
      sequence: ["g", "p"],
      onTrigger: () => {
        if (location.pathname !== "/") {
          navigate("/");
        }
      },
    },
    {
      sequence: ["g", "s"],
      onTrigger: () => {
        if (location.pathname !== "/settings") {
          navigate("/settings");
        }
      },
    },
    {
      keys: ["shift+/", "shift+?", "?"],
      onTrigger: () => {
        setShowShortcutsHelp(true);
      },
    },
  ]);

  return (
    <ShortcutsHelpDialog
      isOpen={showShortcutsHelp}
      onClose={() => setShowShortcutsHelp(false)}
      title={t("shortcuts.title")}
      shortcuts={activeShortcuts}
    />
  );
}
