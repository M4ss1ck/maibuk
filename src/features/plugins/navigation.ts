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
  PluginRevealRange,
  PluginRoute,
} from "@/features/plugins/types";
import { getDatabase } from "@/lib/db";

let navigator: PluginNavigator | null = null;

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
 * navigation state when one is given. A missing entity or no registered
 * navigator is a no-op: the call never rejects the Plugin.
 */
export async function openPluginEntity(
  target: PluginEntityTarget,
  reveal?: PluginRevealRange
): Promise<void> {
  const route = await resolvePluginEntityRoute(target);
  if (route === null || navigator === null) return;
  const state = reveal !== undefined ? { ...(route.state ?? {}), reveal } : route.state;
  navigator(route.to, state !== undefined ? { state } : undefined);
}

/**
 * Opens a Plugin page through the registered navigator. A Plugin that is not
 * installed or does not declare the page is a typed `not-found`; the call never
 * rejects the Plugin. Like `openPluginEntity`, no registered navigator is a
 * no-op (the page still resolves for the caller).
 */
export async function openPluginPage(
  pluginId: string,
  pageId: string
): Promise<PluginPageOpenResult> {
  if (getPluginPage(pluginId, pageId) === undefined) return { status: "not-found" };
  navigator?.(pluginPageRoute(pluginId, pageId));
  return { status: "opened" };
}
