import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { SHORTCUTS, type ShortcutId } from "@/lib/shortcut-registry";

// A Bound Shortcut works on the screen the author is on right now. Whatever
// handles a registry shortcut declares its id while it is mounted and enabled,
// and the shortcut help lists exactly those ids: nothing is kept by hand per route.

interface BoundShortcutState {
  /** How many mounted bindings currently declare each id. */
  counts: Partial<Record<ShortcutId, number>>;
  /** Declares ids as bound; the returned function releases them once. */
  bind: (ids: readonly ShortcutId[]) => () => void;
}

const REGISTRY_ORDER = Object.keys(SHORTCUTS) as ShortcutId[];

export const useBoundShortcutStore = create<BoundShortcutState>((set) => ({
  counts: {},
  bind: (ids) => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return () => {};
    set((state) => {
      const counts = { ...state.counts };
      for (const id of unique) counts[id] = (counts[id] ?? 0) + 1;
      return { counts };
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set((state) => {
        const counts = { ...state.counts };
        for (const id of unique) {
          const remaining = (counts[id] ?? 0) - 1;
          if (remaining > 0) counts[id] = remaining;
          else delete counts[id];
        }
        return { counts };
      });
    };
  },
}));

/**
 * Declares registry shortcuts that something other than `useShortcuts` handles
 * (the TipTap keymap, a native control, a panel's own key handler).
 */
export function useBoundShortcutIds(ids: readonly ShortcutId[], enabled = true): void {
  const bind = useBoundShortcutStore((state) => state.bind);
  // A stable key, so a new array with the same ids does not rebind every render.
  const key = enabled ? ids.join("|") : "";
  useEffect(() => {
    if (!key) return;
    return bind(key.split("|") as ShortcutId[]);
  }, [bind, key]);
}

/** The shortcuts that work on this screen right now, in registry order. */
export function useBoundShortcuts(): ShortcutId[] {
  const counts = useBoundShortcutStore((state) => state.counts);
  return useMemo(() => REGISTRY_ORDER.filter((id) => (counts[id] ?? 0) > 0), [counts]);
}
