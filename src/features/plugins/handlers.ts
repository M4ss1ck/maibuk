/**
 * The host-side Plugin API handlers this app wires (ADR 0022, #440):
 * `notifications.show` renders a toast naming the Plugin; the Library reads
 * serve Books, Chapters, Notes, Canvas metadata, and Library Search (#641); the Library writes
 * (#452, #588) update a Book's details or take a Checkpoint, create, delete,
 * reorder, or update a Chapter, and create, update, or delete a Note through
 * the entity's own write path; the editor writes (`editor.insert` /
 * `editor.replace`, #452) edit the focused editor as one undoable step;
 * `storage.*` reads and writes the Plugin's own
 * Library namespace; `navigation.openEntity` opens an entity through the app
 * shell;
 * `navigation.openPage` opens a Plugin page;
 * `language.get` reads the app language; `endpoint.address` reads this Plugin's
 * Plugin Endpoint address; `permissions.granted` lists the calling Plugin's own
 * Plugin Permissions; `secrets.*` writes the calling
 * Plugin's credentials through the registered store; `network.fetch` fetches
 * on a granted host and streams the body, injecting a named secret into a
 * declared header; `clipboard.*` reads and writes the platform clipboard;
 * `files.*` picks, reads, and releases File Grants through the registered
 * store (ADR 0036); and
 * `toolbar.setPressed` sets one of the Plugin's Toggle Buttons on or off.
 * The broker already enforces each row's Plugin Permission, input schema,
 * Library availability, user action, and rate limit, so a handler only does its work.
 */

import { toast } from "@/components/ui/Toast";
import { getPluginApproval } from "@/features/plugins/approvals";
import {
  getPluginEditorContent,
  getPluginEditorSelection,
  insertInFocusedEditor,
  replaceInFocusedEditor,
  revealInFocusedEditor,
  setPluginEditorHighlights,
} from "@/features/plugins/editor-host";
import { endpointUrlFor } from "@/features/plugins/endpoint";
import {
  getPluginFileGrantStore,
  type PluginFileGrantStore,
} from "@/features/plugins/file-grants";
import { currentPluginLanguage } from "@/features/plugins/language";
import {
  checkpointPluginBook,
  createPluginChapter,
  createPluginNote,
  deletePluginChapter,
  deletePluginNote,
  getPluginBook,
  getPluginCanvas,
  getPluginChapter,
  getPluginNote,
  listPluginBooks,
  listPluginCanvases,
  listPluginChapters,
  listPluginNotes,
  reorderPluginChapters,
  searchPluginLibrary,
  updatePluginBook,
  updatePluginChapter,
  updatePluginChapterContent,
  updatePluginNote,
} from "@/features/plugins/library";
import { usePluginManagementStore } from "@/features/plugins/management";
import { openPluginEntity, openPluginPage } from "@/features/plugins/navigation";
import { pluginFetch } from "@/features/plugins/network";
import { getPluginSecretStore, type PluginSecretStore } from "@/features/plugins/secret-store";
import {
  deletePluginStorageValue,
  getPluginStorageValue,
  listPluginStorageKeys,
  setPluginStorageValue,
} from "@/features/plugins/storage";
import { setToolbarPressed } from "@/features/plugins/toolbar-pressed";
import type { PluginApiHandlers, PluginManifest } from "@/features/plugins/types";
import { getClipboard, getPluginFetch } from "@/lib/platform";
import type { ClipboardAdapter } from "@/lib/platform/types";
import { PluginApiError } from "@/plugin-sdk/protocol";

/**
 * The registered credential store. Reset settings and removal delete through
 * the same seam, so a running app always has one; without it a `secrets.*`
 * call is a host failure, not a call the Plugin can retry.
 */
function pluginSecretStore(): PluginSecretStore {
  const store = getPluginSecretStore();
  if (!store) {
    throw new PluginApiError({
      code: "internal-error",
      message: "No Plugin secret store is registered in Maibuk",
    });
  }
  return store;
}

/**
 * The registered File Grant store. The app always registers one, so without it
 * a `files.*` call is a host failure, not a call the Plugin can retry.
 */
function pluginFileGrantStore(): PluginFileGrantStore {
  const store = getPluginFileGrantStore();
  if (!store) {
    throw new PluginApiError({
      code: "internal-error",
      message: "No Plugin File Grant store is registered in Maibuk",
    });
  }
  return store;
}

/**
 * Runs one clipboard operation through the platform adapter. A browser
 * clipboard call rejects when the page lacks permission or focus; the Plugin
 * sees one typed refusal rather than the platform's own error.
 */
async function runClipboard<T>(
  action: "read" | "written",
  run: (clipboard: ClipboardAdapter) => Promise<T>
): Promise<T> {
  try {
    return await run(await getClipboard());
  } catch (error) {
    if (error instanceof PluginApiError) throw error;
    throw new PluginApiError({
      code: "internal-error",
      message: `The clipboard could not be ${action}.`,
    });
  }
}

/**
 * Refuses a `toolbar.setPressed` the manifest cannot back: the Plugin must
 * declare a toolbar button with that id, and the button must be a Toggle Button.
 */
export function assertToggleButton(manifest: PluginManifest, button: string): void {
  const declared = manifest.contributes?.toolbarButtons?.find((entry) => entry.id === button);
  if (declared === undefined) {
    throw new PluginApiError({ code: "invalid-params", message: `No toolbar button ${button}` });
  }
  if (declared.toggle !== true) {
    throw new PluginApiError({
      code: "invalid-params",
      message: `Toolbar button ${button} is not a Toggle Button`,
    });
  }
}

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
    "library.books.update": ({ bookId, title, authorName, genre, status, targetWordCount }) =>
      updatePluginBook({ bookId, title, authorName, genre, status, targetWordCount }),
    "library.books.checkpoint": ({ bookId, label }) => checkpointPluginBook({ bookId, label }),
    "library.chapters.list": ({ bookId }) => listPluginChapters(bookId),
    "library.chapters.get": ({ chapterId }) => getPluginChapter(chapterId),
    "library.notes.list": ({ bookId }) => listPluginNotes(bookId),
    "library.notes.get": ({ noteId }) => getPluginNote(noteId),
    "library.chapters.updateContent": ({ chapterId, content, expectedUpdatedAt }) =>
      updatePluginChapterContent(chapterId, content, expectedUpdatedAt),
    "library.chapters.create": ({ bookId, title, position, content }) =>
      createPluginChapter({ bookId, title, position, content }),
    "library.chapters.delete": ({ chapterId }) => deletePluginChapter(chapterId),
    "library.chapters.reorder": ({ bookId, chapterIds }) =>
      reorderPluginChapters({ bookId, chapterIds }),
    "library.chapters.update": ({ chapterId, title, chapterType, status }) =>
      updatePluginChapter({ chapterId, title, chapterType, status }),
    "library.notes.create": ({ title, bookId, content, tags }) =>
      createPluginNote({ title, bookId, content, tags }),
    "library.notes.update": ({ noteId, title, content, tags, bookId, expectedUpdatedAt }) =>
      updatePluginNote({ noteId, title, content, tags, bookId, expectedUpdatedAt }),
    "library.notes.delete": ({ noteId }) => deletePluginNote(noteId),
    "library.canvases.list": ({ bookId }) => listPluginCanvases(bookId),
    "library.canvases.get": ({ canvasId }) => getPluginCanvas(canvasId),
    "library.search": (params) => searchPluginLibrary(params),
    "editor.getContent": () => getPluginEditorContent(),
    "editor.getSelection": () => getPluginEditorSelection(),
    "editor.reveal": ({ range }) => revealInFocusedEditor(range),
    "editor.insert": ({ content }) => insertInFocusedEditor(content),
    "editor.replace": ({ range, content }) => replaceInFocusedEditor(range, content),
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
    "navigation.openEntity": ({ entity, reveal }) =>
      openPluginEntity(entity, reveal).then(() => null),
    "navigation.openPage": ({ pageId, pluginId }, context) =>
      openPluginPage(pluginId ?? context.pluginId, pageId),
    "language.get": async () => ({ language: currentPluginLanguage() }),
    "endpoint.address": (_params, { pluginId }) => ({
      url: endpointUrlFor(usePluginManagementStore.getState().endpoint, pluginId),
    }),
    "permissions.granted": (_params, { pluginId }) => ({
      permissions: [...(getPluginApproval(pluginId)?.granted ?? [])],
    }),
    "secrets.set": async ({ name, value }, { pluginId }) => {
      await pluginSecretStore().set(pluginId, name, value);
      return null;
    },
    "secrets.delete": async ({ name }, { pluginId }) => {
      await pluginSecretStore().delete(pluginId, name);
      return null;
    },
    // Names only: no handler in this app ever returns a secret value to a Plugin.
    "secrets.listNames": async (_params, { pluginId }) => pluginSecretStore().listNames(pluginId),
    "network.fetch": async (params, { pluginId }) =>
      pluginFetch(params, {
        pluginId,
        store: pluginSecretStore(),
        fetch: await getPluginFetch(),
      }),
    "toolbar.setPressed": ({ button, pressed }) => {
      assertToggleButton(manifest, button);
      setToolbarPressed(manifest.id, button, pressed);
      return null;
    },
    "clipboard.readText": () => runClipboard("read", (clipboard) => clipboard.readText()),
    "clipboard.writeText": ({ text }) =>
      runClipboard("written", (clipboard) => clipboard.writeText(text)).then(() => null),
    // File Grant rows resolve through the store; `async` also makes a missing
    // store a rejected promise, the way every other host failure arrives.
    "files.pick": async ({ extensions }, { pluginId }) =>
      pluginFileGrantStore().pick(pluginId, extensions),
    "files.read": async ({ grant, offset, length }, { pluginId }) =>
      pluginFileGrantStore().read(pluginId, grant, offset, length),
    "files.stat": async ({ grant }, { pluginId }) => pluginFileGrantStore().stat(pluginId, grant),
    "files.requestAccess": async ({ grant }, { pluginId }) =>
      pluginFileGrantStore().requestAccess(pluginId, grant),
    "files.release": async ({ grant }, { pluginId }) => {
      await pluginFileGrantStore().release(pluginId, grant);
      return null;
    },
    "files.list": async (_params, { pluginId }) => pluginFileGrantStore().list(pluginId),
  };
}
