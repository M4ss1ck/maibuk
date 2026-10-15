/**
 * The host-side Plugin API handlers this app wires (ADR 0022, #440):
 * `notifications.show` renders a toast naming the Plugin; the Library reads
 * serve Books, Chapters, Notes, and Canvas metadata; the Library writes
 * (#452) update a Chapter's content and create or update a Note through the
 * entity's own write path; `storage.*` reads and writes the Plugin's own
 * Library namespace; `navigation.openEntity` opens an entity through the app
 * shell; `navigation.openPage` opens a Plugin page; `language.get` reads the
 * app language. The
 * broker already enforces each row's Plugin Permission, input schema, Library
 * availability, and rate limit, so a handler only does its work.
 */

import { toast } from "@/components/ui/Toast";
import {
  getPluginEditorContent,
  getPluginEditorSelection,
  revealInFocusedEditor,
  setPluginEditorHighlights,
} from "@/features/plugins/editor-host";
import { currentPluginLanguage } from "@/features/plugins/language";
import {
  createPluginNote,
  getPluginBook,
  getPluginCanvas,
  getPluginChapter,
  getPluginNote,
  listPluginBooks,
  listPluginCanvases,
  listPluginChapters,
  listPluginNotes,
  updatePluginChapterContent,
  updatePluginNote,
} from "@/features/plugins/library";
import { openPluginEntity, openPluginPage } from "@/features/plugins/navigation";
import {
  deletePluginStorageValue,
  getPluginStorageValue,
  listPluginStorageKeys,
  setPluginStorageValue,
} from "@/features/plugins/storage";
import type { PluginApiHandlers, PluginManifest } from "@/features/plugins/types";

export function createPluginHandlers(manifest: PluginManifest): PluginApiHandlers {
  return {
    "notifications.show": ({ variant, message }) => {
      const text = `${manifest.name}: ${message}`;
      if (variant === "error") toast.error(text);
      else if (variant === "success") toast.success(text);
      else toast.info(text);
      return null;
    },
    "library.books.list": () => listPluginBooks(),
    "library.books.get": ({ bookId }) => getPluginBook(bookId),
    "library.chapters.list": ({ bookId }) => listPluginChapters(bookId),
    "library.chapters.get": ({ chapterId }) => getPluginChapter(chapterId),
    "library.notes.list": ({ bookId }) => listPluginNotes(bookId),
    "library.notes.get": ({ noteId }) => getPluginNote(noteId),
    "library.chapters.updateContent": ({ chapterId, content }) =>
      updatePluginChapterContent(chapterId, content),
    "library.notes.create": ({ title, bookId, content }) =>
      createPluginNote({ title, bookId, content }),
    "library.notes.update": ({ noteId, title, content }) =>
      updatePluginNote({ noteId, title, content }),
    "library.canvases.list": ({ bookId }) => listPluginCanvases(bookId),
    "library.canvases.get": ({ canvasId }) => getPluginCanvas(canvasId),
    "editor.getContent": () => getPluginEditorContent(),
    "editor.getSelection": () => getPluginEditorSelection(),
    "editor.reveal": ({ range }) => revealInFocusedEditor(range),
    "editor.setHighlights": ({ kind, ranges }, { pluginId }) =>
      setPluginEditorHighlights(pluginId, { kind, ranges }),
    "storage.get": async ({ key }, { pluginId }) => {
      const value = await getPluginStorageValue(pluginId, key);
      return value === undefined ? null : value;
    },
    "storage.set": async ({ key, value }, { pluginId }) => {
      await setPluginStorageValue(pluginId, key, value);
      return null;
    },
    "storage.delete": async ({ key }, { pluginId }) => {
      await deletePluginStorageValue(pluginId, key);
      return null;
    },
    "storage.keys": (_params, context) => listPluginStorageKeys(context.pluginId),
    "navigation.openEntity": ({ entity, reveal }) => openPluginEntity(entity, reveal).then(() => null),
    "navigation.openPage": ({ pageId, pluginId }, context) =>
      openPluginPage(pluginId ?? context.pluginId, pageId),
    "language.get": async () => ({ language: currentPluginLanguage() }),
  };
}
