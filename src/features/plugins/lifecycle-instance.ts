/**
 * The app's one Plugin lifecycle, held apart from `lifecycle.ts` so the UI can
 * read and subscribe to it without pulling the state machine's heavy imports
 * (sync, backup, storage, the database) into the first chunk. `main.tsx`
 * dynamic-imports `lifecycle.ts` in idle time; this leaf stays small.
 */

import type { PluginLifecycle } from "@/features/plugins/types";

let installedLifecycle: PluginLifecycle | null = null;
const installedListeners = new Set<() => void>();

export function getPluginLifecycle(): PluginLifecycle | null {
  return installedLifecycle;
}

/** Installs the app's one lifecycle and tells the surfaces that waited for it. */
export function setPluginLifecycleInstance(lifecycle: PluginLifecycle | null): void {
  installedLifecycle = lifecycle;
  if (lifecycle === null) return;
  for (const listener of [...installedListeners]) listener();
}

/** Runs when the app's one lifecycle is installed. Returns unsubscribe. */
export function onPluginLifecycleInstalled(listener: () => void): () => void {
  installedListeners.add(listener);
  return () => {
    installedListeners.delete(listener);
  };
}

export function resetPluginLifecycleForTests(): void {
  installedLifecycle?.dispose();
  installedLifecycle = null;
}
