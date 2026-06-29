import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcuts } from "@/lib/shortcuts";
import { useTranslation } from "react-i18next";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useThemeStore, getCycledTheme } from "@/features/theme";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { useNoteStore } from "@/features/notes";
import { getPassphrase } from "@/features/sync/crypto";
import { IS_TAURI } from "@/lib/platform";
import { useActiveShortcuts } from "@/hooks";

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

  const activeShortcuts = useActiveShortcuts();

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
      sequence: ["g", "c"],
      onTrigger: () => {
        if (location.pathname !== "/canvas") {
          navigate("/canvas");
        }
      },
    },
    {
      sequence: ["g", "t"],
      onTrigger: () => {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(getCycledTheme(theme, prefersDark));
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
          store.syncSingleBook(bookMatch[1], passphrase, skipConflicts).catch(() => {});
          return;
        }

        if (location.pathname.startsWith("/notes/")) {
          const { currentNote } = useNoteStore.getState();
          if (currentNote) {
            store.syncSingleNote(currentNote.id, passphrase, skipConflicts).catch(() => {});
            return;
          }
        }

        store.syncAll(passphrase, skipConflicts).catch(() => {});
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
