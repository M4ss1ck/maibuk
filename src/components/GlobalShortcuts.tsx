import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcuts } from "@/lib/shortcuts";
import { useFocusCommands } from "@/lib/focus-commands";
import { ShortcutsHelpDialog } from "@/components/ShortcutsHelpDialog";
import { ShortcutEditorDialog } from "@/components/shortcuts/ShortcutEditorDialog";
import { noticeMessage } from "@/components/dictation/dictation-messages";
import { toast } from "@/components/ui/Toast";
import { getDictation } from "@/features/dictation/runtime";
import { cycleDictationLanguage } from "@/features/dictation/language";
import { useDictationStore } from "@/features/dictation/store";
import { useCommandPaletteStore } from "@/features/command-palette";
import { useThemeStore, getCycledTheme } from "@/features/theme";
import { useSettingsStore } from "@/features/settings/store";
import { useSyncStore } from "@/features/sync/store";
import { useNoteStore } from "@/features/notes";
import { getPassphrase } from "@/features/sync/crypto";
import { IS_DESKTOP } from "@/lib/platform";
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
  // Only the innermost ones are stops: the outer one is the same region. A
  // pane marked nested (the Footnotes after the text) is a region of its own
  // inside its outer pane, so both stay stops.
  const isNested = (pane: HTMLElement) => pane.hasAttribute("data-focus-pane-nested");
  const panes = visible.filter(
    (pane) =>
      isNested(pane) ||
      !visible.some((other) => other !== pane && !isNested(other) && pane.contains(other))
  );
  if (panes.length === 0) return;

  const active = document.activeElement;
  // Document order puts an outer pane before the nested one, so the last pane
  // holding focus is the innermost.
  let currentIndex = -1;
  panes.forEach((pane, index) => {
    if (pane === active || pane.contains(active)) currentIndex = index;
  });
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
  const { t } = useTranslation();
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showShortcutEditor, setShowShortcutEditor] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const hideKeyboardHints = useSettingsStore((state) => state.hideKeyboardHints);
  const setHideKeyboardHints = useSettingsStore((state) => state.setHideKeyboardHints);
  const alwaysOnTop = useSettingsStore((state) => state.alwaysOnTop);
  const setAlwaysOnTop = useSettingsStore((state) => state.setAlwaysOnTop);
  // Unbound until the runtime reports support, so an unsupported device lists no Dictation shortcut.
  const dictationSupported = useDictationStore((state) => state.support?.supported === true);
  const dictationEnabled = useDictationStore((state) => state.enabled);

  // The browser's own keys as voice-runnable Commands; above the Tutorial
  // boundary, so they work while a run is under way.
  useFocusCommands();

  // Session notices become a toast and/or a screen-reader announcement. The
  // runtime may not exist yet (unsupported build), so a failure is silent.
  useEffect(() => {
    let cancelled = false;
    void getDictation()
      .then((runtime) => {
        if (cancelled) return;
        runtime.setNotifier((notice) => {
          const message = noticeMessage(notice, t);
          if (message.toast) toast[message.toast.variant](message.toast.text);
          if (message.announce) useDictationStore.setState({ announcement: message.announce });
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [t]);

  useShortcuts([
    {
      id: "global.gotoProjects",
      onTrigger: () => {
        if (location.pathname !== "/") {
          navigate("/");
        }
      },
    },
    {
      id: "global.gotoSettings",
      onTrigger: () => {
        if (location.pathname !== "/settings") {
          navigate("/settings");
        }
      },
    },
    {
      id: "global.gotoMetrics",
      onTrigger: () => {
        if (location.pathname !== "/metrics") {
          navigate("/metrics");
        }
      },
    },
    {
      id: "global.gotoNotes",
      onTrigger: () => {
        if (location.pathname !== "/notes") {
          navigate("/notes");
        }
      },
    },
    {
      id: "global.gotoCanvas",
      onTrigger: () => {
        if (location.pathname !== "/canvas") {
          navigate("/canvas");
        }
      },
    },
    {
      id: "global.gotoEphemeral",
      onTrigger: () => {
        if (location.pathname !== "/ephemeral") {
          navigate("/ephemeral");
        }
      },
    },
    {
      id: "global.toggleTheme",
      onTrigger: () => {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        setTheme(getCycledTheme(theme, prefersDark));
      },
    },
    {
      id: "global.themeLight",
      onTrigger: () => {
        setTheme("light");
      },
    },
    {
      id: "global.themeDark",
      onTrigger: () => {
        setTheme("dark");
      },
    },
    {
      id: "global.themeSystem",
      onTrigger: () => {
        setTheme("system");
      },
    },
    {
      id: "global.toggleShortcutHints",
      onTrigger: () => {
        setHideKeyboardHints(!hideKeyboardHints);
      },
    },
    {
      id: "global.toggleAlwaysOnTop",
      allowInInput: true,
      enabled: IS_DESKTOP,
      onTrigger: () => {
        setAlwaysOnTop(!alwaysOnTop);
      },
    },
    {
      id: "global.syncNow",
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
      id: "global.cyclePanesForward",
      allowInInput: true,
      onTrigger: () => cyclePanes(true),
    },
    {
      id: "global.cyclePanesBackward",
      allowInInput: true,
      onTrigger: () => cyclePanes(false),
    },
    {
      id: "global.showHelp",
      onTrigger: () => {
        setShowShortcutsHelp(true);
      },
    },
    {
      id: "global.openCommandPalette",
      allowInInput: true,
      onTrigger: () => {
        useCommandPaletteStore.getState().open();
      },
    },
    {
      id: "dictation.toggle",
      allowInInput: true,
      enabled: dictationSupported && dictationEnabled,
      onTrigger: () =>
        void getDictation()
          .then((runtime) => runtime.session.toggle())
          .catch(() => {}),
    },
    {
      id: "dictation.cycleLanguage",
      allowInInput: true,
      enabled: dictationSupported && dictationEnabled,
      onTrigger: () => void cycleDictationLanguage(t).catch(() => {}),
    },
  ]);

  return (
    <>
      <ShortcutsHelpDialog
        isOpen={showShortcutsHelp}
        onClose={() => setShowShortcutsHelp(false)}
        onCustomize={() => {
          setShowShortcutsHelp(false);
          setShowShortcutEditor(true);
        }}
        onStartTutorial={() =>
          requestTutorial({
            section: sectionForPath(location.pathname),
            origin: "help",
            returnTo: location.pathname + location.search,
          })
        }
      />
      <ShortcutEditorDialog
        isOpen={showShortcutEditor}
        onClose={() => {
          setShowShortcutEditor(false);
          setShowShortcutsHelp(true);
        }}
      />
    </>
  );
}
