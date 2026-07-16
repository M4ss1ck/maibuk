import { useState, useCallback, useRef } from "react";
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
import { useActiveShortcuts, type ShortcutItem } from "@/hooks";
import { SHORTCUTS, matchKeys } from "@/lib/shortcut-registry";

function isVisiblePane(pane: HTMLElement): boolean {
  if (pane.closest('[hidden], [inert], [aria-hidden="true"], [data-closed]')) return false;
  const style = window.getComputedStyle(pane);
  return style.display !== "none" && style.visibility !== "hidden";
}

function cyclePanes(forward: boolean) {
  const panes = [...document.querySelectorAll<HTMLElement>("[data-focus-pane]")].filter(
    isVisiblePane
  );
  if (panes.length === 0) return;

  const active = document.activeElement;
  const currentIndex = panes.findIndex((pane) => pane === active || pane.contains(active));
  const nextIndex =
    currentIndex < 0
      ? forward
        ? 0
        : panes.length - 1
      : (currentIndex + (forward ? 1 : -1) + panes.length) % panes.length;
  panes[nextIndex].focus();
}

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
  const helpSnapshotRef = useRef<ShortcutItem[]>([]);

  const openHelp = useCallback(() => {
    helpSnapshotRef.current = activeShortcuts;
    setShowShortcutsHelp(true);
  }, [activeShortcuts]);

  useShortcuts([
    {
      sequence: SHORTCUTS["global.gotoProjects"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/") {
          navigate("/");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.gotoSettings"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/settings") {
          navigate("/settings");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.gotoMetrics"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/metrics") {
          navigate("/metrics");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.gotoNotes"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/notes") {
          navigate("/notes");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.gotoCanvas"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/canvas") {
          navigate("/canvas");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.gotoEphemeral"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/ephemeral") {
          navigate("/ephemeral");
        }
      },
    },
    {
      sequence: SHORTCUTS["global.toggleTheme"].sequence,
      onTrigger: () => {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(getCycledTheme(theme, prefersDark));
      },
    },
    {
      sequence: SHORTCUTS["global.toggleShortcutHints"].sequence,
      onTrigger: () => {
        setHideKeyboardHints(!hideKeyboardHints);
      },
    },
    {
      keys: matchKeys("global.toggleAlwaysOnTop"),
      allowInInput: true,
      enabled: IS_TAURI,
      onTrigger: () => {
        setAlwaysOnTop(!alwaysOnTop);
      },
    },
    {
      keys: matchKeys("global.syncNow"),
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
      keys: matchKeys("global.cyclePanes"),
      allowInInput: true,
      onTrigger: (event) => {
        cyclePanes(!event.shiftKey);
      },
    },
    {
      keys: ["shift+/", "shift+?", "?"],
      onTrigger: () => {
        openHelp();
      },
    },
  ]);

  return (
    <ShortcutsHelpDialog
      isOpen={showShortcutsHelp}
      onClose={() => setShowShortcutsHelp(false)}
      title={t("shortcuts.title")}
      shortcuts={helpSnapshotRef.current}
    />
  );
}
