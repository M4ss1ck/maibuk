/**
 * Host navigation for Plugins: `navigation.openEntity` opens a Book, Chapter,
 * Note, or Canvas, optionally revealing a plain-text range; `navigation.openPage`
 * opens a Plugin page by its page id. The route table and the one `navigate` the
 * app shell provides live here, so the handler only asks to open something and
 * never knows a route. A Chapter's route needs its containing Book, read from
 * the Library at open time; a Plugin page resolves against the installed
 * Plugins' registered pages, so any installed Plugin's page may be opened.
 */

import { getPluginPage, pluginPageRoute } from "@/features/plugins/contributions-registry";
import type {
  PluginEntityTarget,
  PluginNavigator,
  PluginPageOpenResult,
  PluginReturnTarget,
  PluginRevealRange,
  PluginRoute,
} from "@/features/plugins/types";
import { getDatabase } from "@/lib/db";

let navigator: PluginNavigator | null = null;

/** Each caller's parked return targets, innermost last. */
const pendingReturnTargets = new Map<string, Array<{ target: PluginReturnTarget }>>();

/** The return target a caller has parked right now, or null when none is. */
function currentReturnTarget(callerId: string | undefined): PluginReturnTarget | null {
  if (callerId === undefined) return null;
  const stack = pendingReturnTargets.get(callerId);
  if (stack === undefined || stack.length === 0) return null;
  return stack[stack.length - 1].target;
}

/**
 * Registers the app shell's navigator; returns the unregister. The last
 * mounted navigator wins, so a remount replaces a stale one.
 */
export function setPluginNavigator(next: PluginNavigator | null): () => void {
  navigator = next;
  return () => {
    if (navigator === next) navigator = null;
  };
}

/** The route an entity opens, or null when the entity is gone. */
export async function resolvePluginEntityRoute(
  target: PluginEntityTarget
): Promise<PluginRoute | null> {
  const db = await getDatabase();
  switch (target.kind) {
    case "book": {
      const rows = await db.select<{ id: string }[]>("SELECT id FROM books WHERE id = ?", [
        target.id,
      ]);
      if (rows.length === 0) return null;
      return { to: `/book/${target.id}` };
    }
    case "chapter": {
      const rows = await db.select<{ book_id: string }[]>(
        "SELECT book_id FROM chapters WHERE id = ?",
        [target.id]
      );
      if (rows.length === 0) return null;
      return { to: `/book/${rows[0].book_id}`, state: { openChapterId: target.id } };
    }
    case "note": {
      const rows = await db.select<{ id: string }[]>("SELECT id FROM notes WHERE id = ?", [
        target.id,
      ]);
      if (rows.length === 0) return null;
      return { to: `/notes/${target.id}` };
    }
    case "canvas": {
      const rows = await db.select<{ id: string }[]>("SELECT id FROM canvases WHERE id = ?", [
        target.id,
      ]);
      if (rows.length === 0) return null;
      return { to: `/canvas/${target.id}` };
    }
  }
}

/**
 * Opens an entity through the registered navigator, carrying a reveal range as
 * navigation state when one is given and `callerId`'s parked return target when
 * it has one. A missing entity or no registered navigator is a no-op: the call
 * never rejects the Plugin.
 */
export async function openPluginEntity(
  target: PluginEntityTarget,
  reveal?: PluginRevealRange,
  callerId?: string
): Promise<void> {
  const route = await resolvePluginEntityRoute(target);
  if (route === null || navigator === null) return;
  const base = reveal !== undefined ? { ...(route.state ?? {}), reveal } : route.state;
  const returnTarget = currentReturnTarget(callerId);
  const state =
    returnTarget !== null
      ? { ...(base ?? {}), returnTo: returnTarget.to, returnLabel: returnTarget.label }
      : base;
  navigator(route.to, state !== undefined ? { state } : undefined);
}

/**
 * Runs `run` with a return target parked for `callerId`, so every `openPage`
 * and `openEntity` it makes inside the window carries it as navigation state.
 * Targets nest per caller, and the entry is removed when the run settles, so a
 * run that opens nothing leaves none behind.
 */
export async function withPluginReturnTarget<T>(
  callerId: string,
  target: PluginReturnTarget,
  run: () => Promise<T>
): Promise<T> {
  const entry = { target };
  const stack = pendingReturnTargets.get(callerId);
  if (stack === undefined) pendingReturnTargets.set(callerId, [entry]);
  else stack.push(entry);
  try {
    return await run();
  } finally {
    const entries = pendingReturnTargets.get(callerId);
    if (entries !== undefined) {
      const index = entries.indexOf(entry);
      if (index !== -1) entries.splice(index, 1);
      if (entries.length === 0) pendingReturnTargets.delete(callerId);
    }
  }
}

/** The return target shown on each Plugin's on-screen page, keyed by page `pluginId`. */
const shownReturnTargets = new Map<string, { to: string; label: string }>();

/** Callers told when a shown return target changes. */
const shownReturnTargetListeners = new Set<(pluginId: string, label: string | null) => void>();

/**
 * Stores or clears the return target shown on `pluginId`'s page, telling
 * listeners only when the stored `to` or `label` actually changed.
 */
export function setShownPluginReturnTarget(
  pluginId: string,
  target: PluginReturnTarget | null
): void {
  const previous = shownReturnTargets.get(pluginId);
  if (target === null) {
    if (previous === undefined) return;
    shownReturnTargets.delete(pluginId);
  } else {
    if (previous?.to === target.to && previous.label === target.label) return;
    shownReturnTargets.set(pluginId, { to: target.to, label: target.label });
  }
  for (const listener of shownReturnTargetListeners) listener(pluginId, target?.label ?? null);
}

/** The label of the return target shown on `pluginId`'s page, or null when none is. */
export function shownPluginReturnLabel(pluginId: string): string | null {
  return shownReturnTargets.get(pluginId)?.label ?? null;
}

/** Subscribes to shown return target changes; returns the unsubscribe. */
export function onShownPluginReturnTargetChange(
  listener: (pluginId: string, label: string | null) => void
): () => void {
  shownReturnTargetListeners.add(listener);
  return () => {
    shownReturnTargetListeners.delete(listener);
  };
}

/**
 * Returns from `pluginId`'s on-screen page to the target it shows: `returned`
 * once the registered navigator is sent there, `none` when there is nothing to
 * return to or no navigator is registered.
 */
export function returnFromPluginPage(pluginId: string): { status: "returned" | "none" } {
  const target = shownReturnTargets.get(pluginId);
  if (target === undefined || navigator === null) return { status: "none" };
  navigator(target.to);
  return { status: "returned" };
}

/**
 * Opens a Plugin page through the registered navigator, carrying `callerId`'s
 * parked return target as navigation state. A Plugin that is not installed or
 * does not declare the page is a typed `not-found`; the call never rejects the
 * Plugin. Like `openPluginEntity`, no registered navigator is a no-op (the page
 * still resolves for the caller).
 */
export async function openPluginPage(
  pluginId: string,
  pageId: string,
  callerId?: string
): Promise<PluginPageOpenResult> {
  if (getPluginPage(pluginId, pageId) === undefined) return { status: "not-found" };
  const route = pluginPageRoute(pluginId, pageId);
  const returnTarget = currentReturnTarget(callerId);
  if (returnTarget === null) {
    navigator?.(route);
  } else {
    navigator?.(route, {
      state: { returnTo: returnTarget.to, returnLabel: returnTarget.label },
    });
  }
  return { status: "opened" };
}
