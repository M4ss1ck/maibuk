import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/keyboard";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutIds } from "@/lib/bound-shortcuts";
import { useTutorialStore } from "@/features/tutorial/store";
import type { ShortcutId } from "@/lib/shortcut-registry";

type Shortcut = {
  /** The registry shortcut this binding implements; while enabled it is listed as bound. */
  id?: ShortcutId;
  keys?: string | string[];
  sequence?: readonly [string, string];
  onTrigger: (event: KeyboardEvent) => void;
  preventDefault?: boolean;
  allowInInput?: boolean;
  enabled?: boolean;
};

type UseShortcutsOptions = {
  enabled?: boolean;
  sequenceTimeout?: number;
};

// While a Tutorial run is under way only its own shortcuts work, so a stray
// key never acts on sample content (ADR 0008).
function isTutorialShortcut(shortcut: Shortcut): boolean {
  return shortcut.id === "tutorial.skip";
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.toLowerCase();
}

function eventToCombo(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.metaKey) parts.push("meta");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(normalizeKey(event.key));
  return parts.join("+");
}

function matchesCombo(combo: string, shortcutKeys: string | string[]): boolean {
  const list = Array.isArray(shortcutKeys) ? shortcutKeys : [shortcutKeys];
  return list.map((item) => item.toLowerCase()).includes(combo);
}

export function useShortcuts(shortcuts: Shortcut[], options: UseShortcutsOptions = {}) {
  const shortcutsRef = useRef(shortcuts);
  const sequenceRef = useRef<{ key: string; time: number } | null>(null);
  const modalIdsLen = useModalStore((s) => s.modalIds.length);
  const tutorialRunning = useTutorialStore((s) => s.status !== "idle");
  const isLive = (shortcut: Shortcut) =>
    shortcut.enabled !== false && (!tutorialRunning || isTutorialShortcut(shortcut));

  // Listed as bound regardless of open dialogs: the shortcut help is a dialog.
  const boundIds =
    options.enabled === false
      ? []
      : shortcuts.flatMap((shortcut) => (shortcut.id && isLive(shortcut) ? [shortcut.id] : []));
  useBoundShortcutIds(boundIds);

  const tutorialRunningRef = useRef(tutorialRunning);
  useEffect(() => {
    shortcutsRef.current = shortcuts;
    tutorialRunningRef.current = tutorialRunning;
  }, [shortcuts, tutorialRunning]);

  useEffect(() => {
    if (options.enabled === false) return;
    if (modalIdsLen > 0) {
      sequenceRef.current = null;
      return;
    }

    const timeout = options.sequenceTimeout ?? 600;

    // A shortcut already handled from the capture pass must not fire twice when
    // the same event also reaches the bubble listener.
    const handled = new WeakSet<KeyboardEvent>();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (handled.has(event)) return;
      if (event.isComposing) return;

      const isTyping = isTypingTarget(event.target);
      const now = Date.now();
      const combo = eventToCombo(event);
      const activeShortcuts = shortcutsRef.current.filter(
        (shortcut) =>
          shortcut.enabled !== false &&
          (!tutorialRunningRef.current || isTutorialShortcut(shortcut))
      );

      if (sequenceRef.current) {
        const { key, time } = sequenceRef.current;
        if (now - time > timeout) {
          sequenceRef.current = null;
        } else {
          const secondKey = normalizeKey(event.key);
          const sequenceMatch = activeShortcuts.find((shortcut) => {
            if (!shortcut.sequence) return false;
            if (shortcut.allowInInput !== true && isTyping) return false;
            return (
              shortcut.sequence[0].toLowerCase() === key &&
              shortcut.sequence[1].toLowerCase() === secondKey
            );
          });

          if (sequenceMatch) {
            if (sequenceMatch.preventDefault !== false) {
              event.preventDefault();
            }
            sequenceMatch.onTrigger(event);
            sequenceRef.current = null;
            return;
          }
        }
      }

      const sequenceStarter = activeShortcuts.find((shortcut) => {
        if (!shortcut.sequence) return false;
        if (shortcut.allowInInput !== true && isTyping) return false;
        return normalizeKey(event.key) === shortcut.sequence[0].toLowerCase();
      });

      if (sequenceStarter) {
        if (sequenceStarter.preventDefault !== false) {
          event.preventDefault();
        }
        sequenceRef.current = { key: normalizeKey(event.key), time: now };
        return;
      }

      const match = activeShortcuts.find((shortcut) => {
        if (!shortcut.keys) return false;
        if (shortcut.allowInInput !== true && isTyping) return false;
        return matchesCombo(combo, shortcut.keys);
      });

      if (match) {
        handled.add(event);
        if (match.preventDefault !== false) {
          event.preventDefault();
        }
        match.onTrigger(event);
      }
    };

    // React Spectrum pressables (React Aria menus, listboxes, toolbars) call
    // stopPropagation() on keydown, which hides modifier shortcuts while one of
    // their controls has focus. Those combos are handled in the capture phase,
    // where that cannot reach. Bare keys stay on the bubble listener so those
    // controls keep their arrow, Enter, Space, and typeahead keys.
    const handleCaptureKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) return;
      handleKeyDown(event);
    };

    window.addEventListener("keydown", handleCaptureKeyDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleCaptureKeyDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [options.enabled, options.sequenceTimeout, modalIdsLen]);
}
