import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTutorialRunInProgress } from "@/features/tutorial/library-switch";

export const PALETTE_RECENT_STORAGE_KEY = "maibuk-command-palette-recent";
const MAX_RECENT_KEYS = 10;

interface CommandPaletteRecentState {
  /** Item keys (`${kind}:${id}`), most recent first, at most 10. */
  keys: string[];
  /** Moves the key to the top, trimming to 10; ignored during a Tutorial run. */
  record: (key: string) => void;
  remove: (key: string) => void;
  /** Keeps only keys still listed, order kept; no write when nothing changed. */
  prune: (liveKeys: readonly string[]) => void;
}

function normalizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry === "" || seen.has(entry)) continue;
    seen.add(entry);
    keys.push(entry);
    if (keys.length >= MAX_RECENT_KEYS) break;
  }
  return keys;
}

/**
 * The palette's Recent list, kept on this device only (ADR 0004): one
 * device's habits never follow the author elsewhere. Never synced, never in
 * Backups.
 */
export const useCommandPaletteRecentStore = create<CommandPaletteRecentState>()(
  persist(
    (set) => ({
      keys: [],
      record: (key) => {
        if (isTutorialRunInProgress()) return;
        set((state) => ({
          keys: [key, ...state.keys.filter((entry) => entry !== key)].slice(0, MAX_RECENT_KEYS),
        }));
      },
      remove: (key) =>
        set((state) => ({
          keys: state.keys.filter((entry) => entry !== key),
        })),
      prune: (liveKeys) =>
        set((state) => {
          const live = new Set(liveKeys);
          const next = state.keys.filter((entry) => live.has(entry));
          if (next.length === state.keys.length) return state;
          return { keys: next };
        }),
    }),
    {
      name: PALETTE_RECENT_STORAGE_KEY,
      version: 1,
      partialize: (state) => ({ keys: state.keys }),
      merge: (persisted, current) => ({
        ...current,
        keys: normalizeKeys((persisted as { keys?: unknown } | undefined)?.keys),
      }),
    }
  )
);
