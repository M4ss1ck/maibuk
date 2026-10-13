/**
 * The context-target resolver: which item a targeted Plugin Command acts on
 * when it is invoked from somewhere other than an Item Menu (a Shortcut, the
 * Command Palette, a toolbar button, or a Voice Command), #446.
 *
 * It reads the same stores that track the open item across the app — a
 * Chapter in the editor, an open Note, an open Canvas, its selected node, the
 * Book being edited — which is the read `pluginTargetIsLive` already uses to
 * re-check an Item Menu target. The route gates them: a Chapter stays in
 * `currentChapter` after the author leaves the editor, so only the Book
 * editor route makes it the item the author is in.
 *
 * A Command that declares several kinds gets the most specific one available
 * (a selected Canvas node before its Canvas, a Chapter before its Book),
 * matching how the same Command's Item Menu row binds to the narrowest item.
 * With no matching item the resolver returns null and the caller disables the
 * Command rather than guessing.
 */

import { matchPath } from "react-router-dom";
import type { PluginItemTarget } from "@/features/plugins/commands";
import type { PluginTarget } from "@/features/plugins/contributions-registry";

/** The item the author is in, per kind, or null when this kind does not apply. */
export interface PluginItemContext {
  book: string | null;
  chapter: string | null;
  note: string | null;
  canvas: string | null;
  canvasNode: string | null;
}

/** No item is in context: every targeted Command stays unavailable. */
export const EMPTY_PLUGIN_ITEM_CONTEXT: PluginItemContext = {
  book: null,
  chapter: null,
  note: null,
  canvas: null,
  canvasNode: null,
};

/**
 * Narrowest first: a Command that acts on more than one kind is offered the
 * item its Item Menu row would use. Canvas node before its Canvas, and a
 * Chapter, Note, or Canvas before the Book it lives in.
 */
const TARGET_PRIORITY: readonly PluginTarget[] = [
  "canvasNode",
  "chapter",
  "note",
  "canvas",
  "book",
];

/**
 * The live item for one Command's declared `targets`, or null when none of the
 * declared kinds is in context.
 */
export function resolvePluginTarget(
  targets: readonly PluginTarget[] | undefined,
  context: PluginItemContext
): PluginItemTarget | null {
  if (targets === undefined || targets.length === 0) return null;
  for (const kind of TARGET_PRIORITY) {
    if (!targets.includes(kind)) continue;
    const id = context[kind];
    if (id !== null) return { kind, id };
  }
  return null;
}

/**
 * Narrows the items the stores hold to the ones the active route makes "the
 * item the author is in". `items` is the raw read (the open Chapter, Note,
 * Canvas, Book, and selected Canvas node); a kind the route does not show is
 * dropped here.
 */
export function pluginItemContextForPath(
  pathname: string,
  items: PluginItemContext
): PluginItemContext {
  const bookEditor = matchPath({ path: "/book/:bookId", end: true }, pathname);
  const cover = matchPath({ path: "/book/:bookId/cover", end: true }, pathname);
  const note = matchPath({ path: "/notes/:noteId", end: true }, pathname);
  const canvas = matchPath({ path: "/canvas/:canvasId", end: true }, pathname);
  return {
    book: bookEditor?.params.bookId ?? cover?.params.bookId ?? null,
    // Only the Book editor puts a Chapter in the editor; the Cover designer and
    // every other route keep no Chapter in context.
    chapter: bookEditor !== null ? items.chapter : null,
    note: note?.params.noteId ?? null,
    canvas: canvas?.params.canvasId ?? null,
    // A Canvas node is a target only while one is selected.
    canvasNode: canvas !== null ? items.canvasNode : null,
  };
}
