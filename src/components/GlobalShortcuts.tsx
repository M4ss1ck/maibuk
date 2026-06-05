import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcuts } from "../lib/shortcuts";
import { useTranslation } from "react-i18next";
import { ShortcutsHelpDialog } from "./ShortcutsHelpDialog";
import { useThemeStore } from "../features/theme";
import { useSettingsStore } from "../features/settings/store";
import { useSyncStore } from "../features/sync/store";
import { useNoteStore } from "../features/notes";
import { getPassphrase } from "../features/sync/crypto";
import { IS_TAURI } from "../lib/platform";

export function GlobalShortcuts() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const hideKeyboardHints = useSettingsStore((state) => state.hideKeyboardHints);
  const setHideKeyboardHints = useSettingsStore((state) => state.setHideKeyboardHints);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);

  const cycleTheme = () => {
    if (theme === "light") {
      setTheme("dark");
      return;
    }

    if (theme === "dark") {
      setTheme("system");
      return;
    }

    setTheme("light");
  };

  const activeShortcuts = useMemo(() => {
    const list: { id: string; label: string; keys: string[] }[] = [
      { id: "global.gotoProjects", label: t("shortcuts.gotoProjects"), keys: ["g", "p"] },
      { id: "global.gotoNotes", label: t("shortcuts.gotoNotes"), keys: ["g", "n"] },
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
        { id: "editor.back", label: t("shortcuts.backFromEditor"), keys: ["Backspace"] }
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
      sequence: ["g", "m"],
      onTrigger: () => {
        if (location.pathname !== "/metrics") {
          navigate("/metrics");
        }
      },
    },
    {
      sequence: ["g", "n"],
      onTrigger: () => {
        if (location.pathname !== "/notes") {
          navigate("/notes");
        }
      },
    },
    {
      sequence: ["g", "t"],
      onTrigger: () => {
        cycleTheme();
      },
    },
    {
      sequence: ["g", "h"],
      onTrigger: () => {
        setHideKeyboardHints(!hideKeyboardHints);
      },
    },
    {
      keys: ["ctrl+shift+p", "meta+shift+p"],
      allowInInput: true,
      enabled: IS_TAURI,
      onTrigger: () => {
        setAlwaysOnTop(!alwaysOnTop);
      },
    },
    {
      keys: ["ctrl+shift+y", "meta+shift+y"],
      allowInInput: true,
      onTrigger: () => {
        const store = useSyncStore.getState();
        if (store.authStatus !== "logged-in" || store.syncStatus === "syncing") return;
        const passphrase = getPassphrase();
        if (!passphrase) return;
        const skipConflicts = async () => "cancel" as const;

        // While editing, push only the current content instead of a full sync.
        const bookMatch = location.pathname.match(/^\/book\/([^/]+)$/);
        if (bookMatch) {
          store.syncSingleBook(bookMatch[1], passphrase, skipConflicts).catch(() => { });
          return;
        }

        if (location.pathname === "/notes") {
          const { currentNote } = useNoteStore.getState();
          if (currentNote) {
            store.syncSingleNote(currentNote.id, passphrase, skipConflicts).catch(() => { });
            return;
          }
        }

        store.syncAll(passphrase, skipConflicts).catch(() => { });
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
