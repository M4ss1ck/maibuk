import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcuts } from "@/lib/shortcuts";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { useThemeStore, getCycledTheme } from "@/features/theme";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { useNoteStore } from "@/features/notes";
import { getPassphrase } from "@/features/sync/crypto";
import { IS_DESKTOP } from "@/lib/platform";
import { SHORTCUTS, matchKeys } from "@/lib/shortcut-registry";
import { requestTutorial } from "@/features/tutorial/controller";
import { sectionForPath } from "@/features/tutorial/sections";

function isVisiblePane(pane: HTMLElement): boolean {
  if (pane.closest('[hidden], [inert], [aria-hidden="true"], [data-closed]')) return false;
  const style = window.getComputedStyle(pane);
  return style.display !== "none" && style.visibility !== "hidden";
}

function cyclePanes(forward: boolean) {
  const visible = [...document.querySelectorAll<HTMLElement>("[data-focus-pane]")].filter(
    isVisiblePane
  );
  // Panes nest (the Book Editor's chapter wrapper holds the Chapter list).
  // Only the innermost ones are stops: the outer one is the same region.
  const panes = visible.filter(
    (pane) => !visible.some((other) => other !== pane && pane.contains(other))
  );
  if (panes.length === 0) return;

  const active = document.activeElement;
  let currentIndex = panes.findIndex((pane) => pane === active || pane.contains(active));
  if (currentIndex < 0) {
    // Focus on an outer pane itself counts as being in its first inner one.
    const outer = visible.find((pane) => pane === active);
    if (outer) currentIndex = panes.findIndex((pane) => outer.contains(pane));
  }
  const nextIndex =
    currentIndex < 0
      ? forward
        ? 0
        : panes.length - 1
      : (currentIndex + (forward ? 1 : -1) + panes.length) % panes.length;
  panes[nextIndex].focus();
}

export function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const hideKeyboardHints = useSettingsStore((state) => state.hideKeyboardHints);
  const setHideKeyboardHints = useSettingsStore((state) => state.setHideKeyboardHints);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);

  useShortcuts([
    {
      id: "global.gotoProjects",
      sequence: SHORTCUTS["global.gotoProjects"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/") {
          navigate("/");
        }
      },
    },
    {
      id: "global.gotoSettings",
      sequence: SHORTCUTS["global.gotoSettings"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/settings") {
          navigate("/settings");
        }
      },
    },
    {
      id: "global.gotoMetrics",
      sequence: SHORTCUTS["global.gotoMetrics"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/metrics") {
          navigate("/metrics");
        }
      },
    },
    {
      id: "global.gotoNotes",
      sequence: SHORTCUTS["global.gotoNotes"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/notes") {
          navigate("/notes");
        }
      },
    },
    {
      id: "global.gotoCanvas",
      sequence: SHORTCUTS["global.gotoCanvas"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/canvas") {
          navigate("/canvas");
        }
      },
    },
    {
      id: "global.gotoEphemeral",
      sequence: SHORTCUTS["global.gotoEphemeral"].sequence,
      onTrigger: () => {
        if (location.pathname !== "/ephemeral") {
          navigate("/ephemeral");
        }
      },
    },
    {
      id: "global.toggleTheme",
      sequence: SHORTCUTS["global.toggleTheme"].sequence,
      onTrigger: () => {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(getCycledTheme(theme, prefersDark));
      },
    },
    {
      id: "global.toggleShortcutHints",
      sequence: SHORTCUTS["global.toggleShortcutHints"].sequence,
      onTrigger: () => {
        setHideKeyboardHints(!hideKeyboardHints);
      },
    },
    {
      id: "global.toggleAlwaysOnTop",
      keys: matchKeys("global.toggleAlwaysOnTop"),
      allowInInput: true,
      enabled: IS_DESKTOP,
      onTrigger: () => {
        setAlwaysOnTop(!alwaysOnTop);
      },
    },
    {
      id: "global.syncNow",
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
      id: "global.cyclePanes",
      keys: matchKeys("global.cyclePanes"),
      allowInInput: true,
      onTrigger: (event) => {
        cyclePanes(!event.shiftKey);
      },
    },
    {
      id: "global.showHelp",
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
      onStartTutorial={() =>
        requestTutorial({
          section: sectionForPath(location.pathname),
          origin: "help",
          returnTo: location.pathname + location.search,
        })
      }
    />
  );
}
