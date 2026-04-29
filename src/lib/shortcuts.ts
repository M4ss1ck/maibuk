import { useEffect, useRef } from "react";
import { isTypingTarget } from "./keyboard";

type Shortcut = {
  keys?: string | string[];
  sequence?: [string, string];
  onTrigger: (event: KeyboardEvent) => void;
  preventDefault?: boolean;
  allowInInput?: boolean;
  enabled?: boolean;
};

type UseShortcutsOptions = {
  enabled?: boolean;
  sequenceTimeout?: number;
};

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

  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (options.enabled === false) return;

    const timeout = options.sequenceTimeout ?? 600;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      const isTyping = isTypingTarget(event.target);
      const now = Date.now();
      const combo = eventToCombo(event);
      const activeShortcuts = shortcutsRef.current.filter((shortcut) => shortcut.enabled !== false);

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
        if (match.preventDefault !== false) {
          event.preventDefault();
        }
        match.onTrigger(event);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [options.enabled, options.sequenceTimeout]);
}
