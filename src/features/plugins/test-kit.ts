/**
 * The supported entry point for Plugin tests, built-in and third-party.
 * `createTestHost()` runs the real broker and method table over an in-process
 * MessageChannel with in-memory platform adapters: a Plugin test hands the
 * returned port to its own setup and asserts against the host's records, and
 * never imports the broker, a store, or a platform adapter directly.
 * `renderPage()` goes further and draws one of the Plugin's pages through the
 * real host renderer, over a real Remote UI mount, so a test drives the page
 * with the keyboard and asserts what the host drew.
 *
 * The sandbox itself is not simulated here; the browser lanes prove it. The
 * kit proves the host logic around a Plugin (permissions, the method table,
 * the Library adapter, the Remote UI renderer) in the same jsdom the app's
 * other suites use.
 */

import type { RemoteMutationRecord } from "@remote-dom/core";
import { ThreadMessagePort } from "@quilted/threads";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { countWords } from "@/features/metrics/word-count";
import { createPluginBroker } from "@/features/plugins/broker";
import {
  collectEndpointAnswer,
  dispatchEndpointRequest,
  endpointUrlFor,
} from "@/features/plugins/endpoint";
import { assertToggleButton } from "@/features/plugins/handlers";
import { fragmentToHtml, htmlToPlainText } from "@/features/plugins/library";
import { normalizeNoteTags } from "@/features/notes/tags";
import { applyPluginLocale } from "@/features/plugins/manifest-validate";
import { pluginFetch } from "@/features/plugins/network";
import { openPluginUiMount, type PluginUiMount } from "@/features/plugins/remote-ui/mount";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
import type { PluginUiViolation } from "@/features/plugins/remote-ui/validate";
import type { PluginSecretStore } from "@/features/plugins/secret-store";
import {
  PLUGIN_INIT_MESSAGE,
  PluginApiError,
  base64ToBytes,
  bytesToBase64,
  type PluginUiMountKind,
} from "@/plugin-sdk/protocol";
import type {
  EndpointListenerState,
  PluginApiHandlers,
  PluginApproval,
  PluginManifest,
  PluginPermissionId,
  PluginRuntime,
  TestCheckpoint,
  TestEndpointAnswer,
  TestEndpointRequest,
  TestEndpointStream,
  TestHost,
  TestHostOptions,
  TestNavigation,
  TestNotification,
  TestPage,
  TestPageNavigation,
} from "@/features/plugins/types";

/**
 * Runs a render step inside `act()` only where the test enabled the act
 * environment (Testing Library for React does); elsewhere React warns that
 * act is unsupported, so the step runs directly.
 */
function inAct(step: () => void): void {
  if ((globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT) act(step);
  else step();
}

/**
 * The approval record the Plugin Endpoint dispatcher reads in a test: enabled,
 * holding the grants this host has right now. The pinned hash and the approved
 * files play no part in routing, so they are placeholders.
 */
function endpointApproval(
  manifest: PluginManifest,
  granted: ReadonlySet<PluginPermissionId>
): PluginApproval {
  return {
    pluginId: manifest.id,
    pinnedHash: "h1:test",
    granted: [...granted],
    enabled: true,
    approvedVersion: manifest.version,
    approvedPermissions: {
      required: [...manifest.permissions.required],
      optional: [...manifest.permissions.optional],
    },
    approvedFiles: {},
  };
}

/**
 * The refusal the app's handler gives for a Chapter no row holds, so a test
 * sees the same error the real Library write produces.
 */
function chapterNotFound(chapterId: string): PluginApiError {
  return new PluginApiError({
    code: "invalid-params",
    message: `Chapter ${chapterId} does not exist`,
  });
}

/**
 * The refusal the app's handler gives for a Book no row holds, so a test sees
 * the same error the real Library write produces.
 */
function bookNotFound(bookId: string): PluginApiError {
  return new PluginApiError({
    code: "invalid-params",
    message: `Book ${bookId} does not exist`,
  });
}

/**
 * The refusal the app's handler gives for a Note no row holds, so a test sees
 * the same error the real Library write produces.
 */
function noteNotFound(noteId: string): PluginApiError {
  return new PluginApiError({
    code: "invalid-params",
    message: `Note ${noteId} does not exist`,
  });
}

export function createTestHost(options: TestHostOptions): TestHost {
  const channel = new MessageChannel();
  const notifications: TestNotification[] = [];
  const navigations: TestNavigation[] = [];
  const pageNavigations: TestPageNavigation[] = [];
  const books = [...(options.library?.books ?? [])];
  const chapters = [...(options.library?.chapters ?? [])];
  const notes = [...(options.library?.notes ?? [])];
  const canvases = [...(options.library?.canvases ?? [])];
  // Library writes (#591). The kit keeps the Library a Plugin writes in memory,
  // so a test asserts the state its write produced. Content conversion and the
  // plain-text read are the host's own helpers, so no escaping rule is
  // re-implemented here. A Book starts out changed (it has no Version yet) and
  // is marked changed again by any Chapter content write, like the real
  // Version path sees it; only taken Checkpoints are recorded.
  const checkpoints: TestCheckpoint[] = [];
  const unchangedBooks = new Set<string>();
  const pendingEdits = new Map<string, string>();
  let nextVersion = 1;
  let nextCreatedChapter = 1;
  let nextCreatedNote = 1;
  const storage = options.storage ?? new Map<string, unknown>();
  const secrets = options.secrets ?? new Map<string, string>();
  const testFetch = options.fetch;
  let clipboard = options.clipboard ?? "";
  // The pressed state of each Toggle Button the Plugin set, by its local id.
  const toolbarPressedState = new Map<string, boolean>();
  let language = options.language ?? "en";
  let libraryAvailable = true;

  /**
   * Flushes every pending author edit into the in-memory Library, the way the
   * app's pending-edits flush does before a Library write or Checkpoint. Returns
   * the set of Chapter ids whose stored content moved.
   */
  function flushPendingEdits(): Set<string> {
    const changed = new Set<string>();
    for (const [chapterId, html] of pendingEdits) {
      const chapter = chapters.find((entry) => entry.id === chapterId);
      if (!chapter) continue;
      chapter.content = { html, text: htmlToPlainText(html) };
      chapter.updatedAt = Math.max(Date.now(), chapter.updatedAt + 1);
      unchangedBooks.delete(chapter.bookId);
      changed.add(chapterId);
    }
    pendingEdits.clear();
    return changed;
  }

  /** The Book's Chapters in stored order: the sequence a position or a reorder names. */
  function chapterOrder(bookId: string): string[] {
    return chapters
      .filter((chapter) => chapter.bookId === bookId)
      .sort((a, b) => a.order - b.order)
      .map((chapter) => chapter.id);
  }

  /** Moves one row's Last Edited forward, the way the row writer stamps it. */
  function stampRow(row: { updatedAt: number }): void {
    row.updatedAt = Math.max(Date.now(), row.updatedAt + 1);
  }

  /** Writes a Book's new Chapter order the way the row writer does: 0-based. */
  function applyChapterOrder(bookId: string, chapterIds: readonly string[]): void {
    for (const [index, chapterId] of chapterIds.entries()) {
      const chapter = chapters.find((entry) => entry.id === chapterId && entry.bookId === bookId);
      if (chapter === undefined) continue;
      chapter.order = index;
      stampRow(chapter);
    }
    unchangedBooks.delete(bookId);
  }

  /** Moves a Book's Last Edited and marks it changed for the Version path. */
  function touchBook(bookId: string): void {
    const book = books.find((entry) => entry.id === bookId);
    if (book !== undefined) stampRow(book);
    unchangedBooks.delete(bookId);
  }
  // The Plugin Endpoint's listener as this host fakes it: off until the test
  // gives the Plugin an address, then bound on that port.
  let endpointState: EndpointListenerState = { state: "off" };
  const startReason = options.startReason ?? "enable";
  const declared = [
    ...options.manifest.permissions.required,
    ...options.manifest.permissions.optional,
  ] as PluginPermissionId[];
  let granted = new Set<PluginPermissionId>(options.permissions ?? declared);

  // The `network.fetch` header injection reads through the same store seam the
  // app registers, over the test's in-memory `secrets`, scoped to this Plugin.
  const secretStore: PluginSecretStore = {
    set: async (pluginId, name, value) => {
      if (pluginId === options.manifest.id) secrets.set(name, value);
    },
    delete: async (pluginId, name) => {
      if (pluginId === options.manifest.id) secrets.delete(name);
    },
    listNames: async (pluginId) =>
      pluginId === options.manifest.id ? [...secrets.keys()].sort() : [],
    read: async (pluginId, name) =>
      pluginId === options.manifest.id ? (secrets.get(name) ?? null) : null,
    clearPlugin: async (pluginId) => {
      if (pluginId === options.manifest.id) secrets.clear();
    },
    clearAll: async () => {
      secrets.clear();
    },
  };

  const networkHandler: PluginApiHandlers = testFetch
    ? {
        "network.fetch": (params, { pluginId }) =>
          pluginFetch(params, { pluginId, store: secretStore, fetch: testFetch }),
      }
    : {};

  const handlers: PluginApiHandlers = {
    "notifications.show": ({ variant, message }) => {
      notifications.push({ variant, message });
      return null;
    },
    "library.books.list": () => books,
    "library.books.get": ({ bookId }) => books.find((book) => book.id === bookId) ?? null,
    // The Book field write (#592): a null Genre or Target Word Count clears it,
    // and a call naming no field is refused before anything is touched.
    "library.books.update": ({ bookId, title, authorName, genre, status, targetWordCount }) => {
      const changes = {
        ...(title === undefined ? {} : { title }),
        ...(authorName === undefined ? {} : { authorName }),
        ...(genre === undefined ? {} : { genre }),
        ...(status === undefined ? {} : { status }),
        ...(targetWordCount === undefined ? {} : { targetWordCount }),
      };
      if (Object.keys(changes).length === 0) {
        throw new PluginApiError({
          code: "invalid-params",
          message: "Give at least one Book field to update",
        });
      }
      const book = books.find((entry) => entry.id === bookId);
      if (book === undefined) throw bookNotFound(bookId);
      Object.assign(book, changes);
      touchBook(bookId);
      return null;
    },
    "library.chapters.list": ({ bookId }) =>
      chapters
        .filter((chapter) => chapter.bookId === bookId)
        .sort((a, b) => a.order - b.order)
        .map(({ content: _content, ...summary }) => summary),
    "library.chapters.get": ({ chapterId }) => {
      const chapter = chapters.find((entry) => entry.id === chapterId);
      if (!chapter) return null;
      const { content, ...summary } = chapter;
      return { ...summary, content: content ?? { text: "", html: "" } };
    },
    // The two writes a test of an editing Plugin needs (#591): a Chapter
    // content write keeps the host's conversion, and a Checkpoint records
    // itself only when the Book changed since the last one.
    "library.chapters.updateContent": ({ chapterId, content, expectedUpdatedAt }) => {
      const chapter = chapters.find((entry) => entry.id === chapterId);
      if (!chapter) throw chapterNotFound(chapterId);
      const flushed = flushPendingEdits();
      if (
        expectedUpdatedAt !== undefined &&
        (flushed.has(chapterId) || chapter.updatedAt !== expectedUpdatedAt)
      ) {
        throw new PluginApiError({
          code: "conflict",
          message: `Chapter ${chapterId} changed since it was read`,
        });
      }
      const html = fragmentToHtml(content);
      chapter.content = { html, text: htmlToPlainText(html) };
      // Strictly increasing, so Last Edited always moves forward even when two
      // writes land in the same millisecond.
      chapter.updatedAt = Math.max(Date.now(), chapter.updatedAt + 1);
      unchangedBooks.delete(chapter.bookId);
      return null;
    },
    // The remaining Chapter writes (#592): create, delete, reorder, and the
    // title/Chapter Type/Chapter Status update, each through the same rules the
    // app's handlers apply, so a test asserts the Library state they produced.
    "library.chapters.create": ({ bookId, title, position, content }) => {
      if (!books.some((entry) => entry.id === bookId)) throw bookNotFound(bookId);
      const before = chapterOrder(bookId);
      if (position !== undefined && (position < 0 || position > before.length)) {
        throw new PluginApiError({
          code: "invalid-params",
          message: `position ${position} is outside 0 to ${before.length} for Book ${bookId}`,
        });
      }
      const html = content === undefined ? undefined : fragmentToHtml(content);
      const chapterId = `chapter-created-${nextCreatedChapter}`;
      nextCreatedChapter += 1;
      const nextOrder = chapters
        .filter((chapter) => chapter.bookId === bookId)
        .reduce((max, chapter) => Math.max(max, chapter.order), -1) + 1;
      chapters.push({
        id: chapterId,
        bookId,
        title,
        order: nextOrder,
        parentId: null,
        chapterType: "chapter",
        wordCount: html === undefined ? 0 : countWords(htmlToPlainText(html)),
        status: "draft",
        updatedAt: Date.now(),
        ...(html === undefined
          ? {}
          : { content: { html, text: htmlToPlainText(html) } }),
      });
      // The row is appended, then the Book is put in the requested order, the
      // create-then-reorder pair the app uses to insert one.
      const ids = chapterOrder(bookId);
      const from = ids.indexOf(chapterId);
      if (from !== position && position !== undefined) {
        ids.splice(from, 1);
        ids.splice(position, 0, chapterId);
        applyChapterOrder(bookId, ids);
      }
      touchBook(bookId);
      return { chapterId };
    },
    "library.chapters.delete": ({ chapterId }) => {
      const index = chapters.findIndex((entry) => entry.id === chapterId);
      if (index === -1) throw chapterNotFound(chapterId);
      const [removed] = chapters.splice(index, 1);
      pendingEdits.delete(chapterId);
      touchBook(removed.bookId);
      return null;
    },
    "library.chapters.reorder": ({ bookId, chapterIds }) => {
      if (!books.some((entry) => entry.id === bookId)) throw bookNotFound(bookId);
      const stored = chapterOrder(bookId);
      const given = chapterIds;
      const exact =
        given.length === stored.length &&
        new Set(given).size === given.length &&
        stored.every((chapterId) => given.includes(chapterId));
      if (!exact) {
        throw new PluginApiError({
          code: "invalid-params",
          message: `chapterIds must be exactly the ${stored.length} Chapters of Book ${bookId}, in the new order`,
        });
      }
      applyChapterOrder(bookId, given);
      return null;
    },
    "library.chapters.update": ({ chapterId, title, chapterType, status }) => {
      const changes = {
        ...(title === undefined ? {} : { title }),
        ...(chapterType === undefined ? {} : { chapterType }),
        ...(status === undefined ? {} : { status }),
      };
      if (Object.keys(changes).length === 0) {
        throw new PluginApiError({
          code: "invalid-params",
          message: "Give at least one Chapter field to update",
        });
      }
      const chapter = chapters.find((entry) => entry.id === chapterId);
      if (chapter === undefined) throw chapterNotFound(chapterId);
      const titleChanged = title !== undefined && title !== chapter.title;
      Object.assign(chapter, changes);
      stampRow(chapter);
      // A title is Book content, so it moves the Book's Last Edited; every
      // Chapter write marks the Book changed for the Version path.
      if (titleChanged) touchBook(chapter.bookId);
      else unchangedBooks.delete(chapter.bookId);
      return null;
    },
    "library.books.checkpoint": ({ bookId, label }) => {
      // Flush any pending author typing before taking the Checkpoint, like the
      // app's pending-edits flush.
      flushPendingEdits();
      // A test-only failure hook (#591): proves a Plugin refuses its write
      // when no Checkpoint could be taken, without touching any other row.
      if (options.checkpointError !== undefined) {
        throw new PluginApiError({
          code: "internal-error",
          message: options.checkpointError,
        });
      }
      if (!books.some((book) => book.id === bookId)) {
        throw new PluginApiError({
          code: "invalid-params",
          message: `Book ${bookId} does not exist`,
        });
      }
      if (unchangedBooks.has(bookId)) return { versionId: null };
      const versionId = `version-${nextVersion}`;
      nextVersion += 1;
      checkpoints.push({ bookId, label, versionId });
      unchangedBooks.add(bookId);
      return { versionId };
    },
    "library.notes.list": ({ bookId }) =>
      notes
        .filter((note) => bookId === undefined || note.bookId === bookId)
        .map(({ content: _content, ...summary }) => summary),
    "library.notes.get": ({ noteId }) => {
      const note = notes.find((entry) => entry.id === noteId);
      if (!note) return null;
      const { content, ...summary } = note;
      return { ...summary, content: content ?? { text: "", html: "" } };
    },
    // The Note writes (#593): create, update, and delete, each through the same
    // rules the app's handlers apply, so a test asserts the Library state they
    // produced.
    "library.notes.create": ({ title, bookId, content }) => {
      const html = content === undefined ? undefined : fragmentToHtml(content);
      const text = html === undefined ? undefined : htmlToPlainText(html);
      const noteId = `note-created-${nextCreatedNote}`;
      nextCreatedNote += 1;
      // A Book Note writes in its Book's language; an Unfiled one in the app's.
      const noteLanguage =
        bookId == null
          ? language
          : (books.find((entry) => entry.id === bookId)?.language ?? language);
      notes.push({
        id: noteId,
        bookId: bookId ?? null,
        title,
        language: noteLanguage,
        tags: [],
        wordCount: text === undefined ? 0 : countWords(text),
        updatedAt: Date.now(),
        ...(html === undefined || text === undefined ? {} : { content: { html, text } }),
      });
      return { noteId };
    },
    "library.notes.update": ({ noteId, title, content, tags, bookId, expectedUpdatedAt }) => {
      if (bookId != null && !books.some((entry) => entry.id === bookId)) {
        throw bookNotFound(bookId);
      }
      const note = notes.find((entry) => entry.id === noteId);
      if (!note) throw noteNotFound(noteId);
      flushPendingEdits();
      // The guard the app applies: a write computed from a stale read is
      // refused, so a test proves a Plugin never overwrites newer text.
      if (expectedUpdatedAt !== undefined && note.updatedAt !== expectedUpdatedAt) {
        throw new PluginApiError({
          code: "conflict",
          message: `Note ${noteId} changed since it was read`,
        });
      }
      const html = content === undefined ? undefined : fragmentToHtml(content);
      if (title !== undefined) note.title = title;
      if (html !== undefined) {
        const text = htmlToPlainText(html);
        note.content = { html, text };
        note.wordCount = countWords(text);
      }
      if (tags !== undefined) note.tags = normalizeNoteTags(tags);
      // `undefined` keeps the stored Book; null is Unfiled.
      if (bookId !== undefined) note.bookId = bookId;
      stampRow(note);
      return null;
    },
    "library.notes.delete": ({ noteId }) => {
      const index = notes.findIndex((entry) => entry.id === noteId);
      if (index === -1) throw noteNotFound(noteId);
      notes.splice(index, 1);
      return null;
    },
    "library.canvases.list": ({ bookId }) =>
      bookId === undefined ? canvases : canvases.filter((canvas) => canvas.bookId === bookId),
    "library.canvases.get": ({ canvasId }) =>
      canvases.find((canvas) => canvas.id === canvasId) ?? null,
    "storage.get": ({ key }) => {
      const value = storage.get(key);
      return value === undefined ? null : value;
    },
    "storage.set": ({ key, value }) => {
      storage.set(key, value);
      return null;
    },
    "storage.delete": ({ key }) => {
      storage.delete(key);
      return null;
    },
    "storage.keys": () => [...storage.keys()].sort(),
    // Secret values are kept host-side only: `listNames` is the Plugin's one
    // read, and it returns names, never a value.
    "secrets.set": ({ name, value }) => {
      secrets.set(name, value);
      return null;
    },
    "secrets.delete": ({ name }) => {
      secrets.delete(name);
      return null;
    },
    "secrets.listNames": () => [...secrets.keys()].sort(),
    // Present only when the test supplied a fetch; otherwise the row refuses
    // `not-implemented` exactly like any other unwired row.
    ...networkHandler,
    "clipboard.readText": () => clipboard,
    "clipboard.writeText": ({ text }) => {
      clipboard = text;
      return null;
    },
    "navigation.openEntity": ({ entity, reveal }) => {
      navigations.push(reveal === undefined ? { entity } : { entity, reveal });
      return null;
    },
    "navigation.openPage": ({ pageId, pluginId }) => {
      pageNavigations.push({ pluginId: pluginId ?? options.manifest.id, pageId });
      return { status: "opened" };
    },
    "language.get": () => ({ language }),
    "endpoint.address": (_params, { pluginId }) => ({
      url: endpointUrlFor(endpointState, pluginId),
    }),
    "permissions.granted": () => ({ permissions: [...granted] }),
    // Refuses what the host refuses (the same rule as the app's handler), then records the state.
    "toolbar.setPressed": ({ button, pressed }) => {
      assertToggleButton(options.manifest, button);
      toolbarPressedState.set(button, pressed);
      return null;
    },
  };

  const broker = createPluginBroker({
    pluginId: options.manifest.id,
    port: channel.port1,
    declared,
    granted: () => granted,
    handlers,
    isLibraryAvailable: () => libraryAvailable,
    eventSnapshot: (event) => {
      if (event === "language.changed") return { language };
      if (event === "endpoint.addressChanged") {
        return { url: endpointUrlFor(endpointState, options.manifest.id) };
      }
      if (event === "permissions.changed") return { permissions: [...granted] };
      return undefined;
    },
  });

  // Deliver the activation's start reason over the Plugin's own port, the way
  // the Worker receives it on the init message in production; the SDK reads it
  // and exposes it as `client.activation` (#445).
  channel.port1.postMessage({ kind: PLUGIN_INIT_MESSAGE.kind, startReason });

  // The Plugin Endpoint's host side routes with a runtime and an approval, as
  // the app does; here both are this host: the manifest behind the broker,
  // always enabled, with whatever `setGranted` holds at that moment.
  const endpointRuntime: PluginRuntime = {
    manifest: options.manifest,
    broker,
    files: [],
    sendFrame: () => {},
    stop: () => {},
  };
  let nextEndpointRequestId = 1;

  /** The dispatcher message for one Endpoint request the test hands the Plugin. */
  function endpointMessage(request: TestEndpointRequest) {
    const tail = request.path.startsWith("/") ? request.path : `/${request.path}`;
    const headers: [string, string][] = Array.isArray(request.headers)
      ? request.headers.map(([name, value]) => [name, value])
      : Object.entries(request.headers ?? {});
    const bytes =
      request.body === undefined
        ? new Uint8Array()
        : typeof request.body === "string"
          ? new TextEncoder().encode(request.body)
          : request.body;
    return {
      requestId: String(nextEndpointRequestId++),
      pluginId: options.manifest.id,
      request: {
        method: request.method ?? "GET",
        path: `/plugin/${options.manifest.id}${tail}`,
        headers,
        body: bytesToBase64(bytes),
      },
    };
  }

  /**
   * Hands the Plugin one request on its Plugin Endpoint through the very
   * dispatcher the app routes with, and resolves with the answer once it is
   * complete: a streamed answer resolves after its `end`, and its chunks are
   * joined into `body`. Without the `serve` grant the dispatcher answers 404
   * and the request never reaches the Plugin.
   */
  function endpoint(request: TestEndpointRequest): Promise<TestEndpointAnswer> {
    return collectEndpointAnswer((sink) =>
      dispatchEndpointRequest(
        {
          runtime: () => endpointRuntime,
          approval: () => endpointApproval(options.manifest, granted),
        },
        endpointMessage(request),
        sink
      )
    ).then((answer) => ({ ...answer, text: () => new TextDecoder().decode(answer.body) }));
  }

  /** Joins streamed pieces into the one body they carry, decoding split characters whole. */
  function joinStreamed(pieces: readonly Uint8Array[]): Uint8Array {
    const joined = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
    let offset = 0;
    for (const piece of pieces) {
      joined.set(piece, offset);
      offset += piece.length;
    }
    return joined;
  }

  /**
   * Hands the Plugin one request on its Plugin Endpoint and reads a streamed
   * answer chunk by chunk, without waiting for its `end`: a long-lived stream
   * (a `subscriptions/listen` SSE stream never ends on its own) would hang
   * `endpoint()`. A whole answer ends the stream at its head instead.
   */
  function endpointStream(request: TestEndpointRequest): TestEndpointStream {
    const pieces: Uint8Array[] = [];
    let head: { status: number; headers: [string, string][] } | null = null;
    let ended = false;
    let closed = false;
    let resolveHead!: (head: { status: number; headers: [string, string][] }) => void;
    const headPromise = new Promise<{ status: number; headers: [string, string][] }>((resolve) => {
      resolveHead = resolve;
    });
    interface TextWaiter {
      match: string;
      resolve: (text: string) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
    const waiters = new Set<TextWaiter>();

    function currentText(): string {
      return new TextDecoder().decode(joinStreamed(pieces));
    }

    /** Resolves every waiter the body so far already satisfies. */
    function settleWaiters(): void {
      if (waiters.size === 0) return;
      const text = currentText();
      for (const waiter of [...waiters]) {
        if (text.includes(waiter.match)) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(text);
        } else if (ended) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.reject(
            new Error(`The streamed answer ended without ${JSON.stringify(waiter.match)}`)
          );
        }
      }
    }

    /** Rejects every waiter: the test stopped reading, or the head never came. */
    function failWaiters(error: Error): void {
      for (const waiter of [...waiters]) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }

    dispatchEndpointRequest(
      {
        runtime: () => endpointRuntime,
        approval: () => endpointApproval(options.manifest, granted),
      },
      endpointMessage(request),
      {
        respond(nextStatus, nextHeaders, body, nextStreaming) {
          head = { status: nextStatus, headers: nextHeaders };
          resolveHead(head);
          if (nextStreaming) return;
          if (body !== undefined) pieces.push(base64ToBytes(body));
          ended = true;
          settleWaiters();
        },
        chunk(chunk) {
          // The test hung up: the broker drops the rest of the stream, so the
          // Plugin cannot keep writing into a closed assertion.
          if (closed) return false;
          pieces.push(base64ToBytes(chunk));
          settleWaiters();
          return true;
        },
        end() {
          ended = true;
          settleWaiters();
        },
      }
    );

    return {
      head: headPromise,
      chunks: () => pieces.slice(),
      text: () => currentText(),
      waitForText(match, timeoutMs = 5000) {
        const text = currentText();
        if (text.includes(match)) return Promise.resolve(text);
        if (ended) {
          return Promise.reject(
            new Error(`The streamed answer ended without ${JSON.stringify(match)}`)
          );
        }
        return new Promise<string>((resolve, reject) => {
          const waiter: TextWaiter = {
            match,
            resolve,
            reject,
            timer: setTimeout(() => {}, 0),
          };
          waiter.timer = setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `The streamed answer did not contain ${JSON.stringify(match)} within ${timeoutMs} ms`
              )
            );
          }, timeoutMs);
          waiters.add(waiter);
          // A chunk may have landed between the first check and this line.
          settleWaiters();
        });
      },
      close() {
        if (closed) return;
        closed = true;
        failWaiters(new Error("The streamed answer was closed"));
      },
    };
  }

  /** Every page `renderPage` opened and has not unmounted yet. */
  const openPages = new Set<TestPage>();
  /** The live mount behind each open page, so `stopWorker` can sever it. */
  const openMounts = new Map<TestPage, { mount: PluginUiMount; thread: { close(): void } }>();

  function renderSurface(name: string, kind: PluginUiMountKind): Promise<TestPage> {
    const violations: PluginUiViolation[] = [];
    const ui = createPluginRemoteUi({ onViolation: (violation) => violations.push(violation) });
    const mount = openPluginUiMount(broker, name, kind);
    // The thread listens through `addEventListener`, which a MessagePort only
    // dispatches after `start()`.
    mount.port.start();
    // The host end of the mount: exactly what `usePluginRemoteUi` wires, so the
    // page crosses the same thread the app uses.
    const thread = new ThreadMessagePort(mount.port, {
      exports: {
        mutate: (records: readonly RemoteMutationRecord[]) => ui.connection.mutate(records),
        call: (id: string, method: string, ...args: readonly unknown[]) =>
          ui.connection.call(id, method, ...args),
      },
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    inAct(() => {
      root.render(createElement(PluginRemoteUiSurface, { ui, onError: () => {} }));
    });

    const testPage: TestPage = {
      container,
      violations,
      unmount() {
        if (!openPages.delete(testPage)) return;
        openMounts.delete(testPage);
        mount.unmount();
        thread.close();
        inAct(() => {
          root.unmount();
        });
        ui.dispose();
        container.remove();
      },
    };
    openPages.add(testPage);

    return mount.mounted.then(
      () => {
        openMounts.set(testPage, { mount, thread });
        return testPage;
      },
      (error: unknown) => {
        testPage.unmount();
        throw error;
      }
    );
  }

  return {
    port: channel.port2,
    broker,
    manifest: applyPluginLocale(options.manifest, options.locale ?? {}),
    notifications,
    navigations,
    pageNavigations,
    locale: options.locale ?? null,
    startReason,
    get language() {
      return language;
    },
    get clipboard() {
      return clipboard;
    },
    get checkpoints() {
      return checkpoints.slice();
    },
    toolbarPressed(button) {
      return toolbarPressedState.get(button) ?? false;
    },
    setClipboard(next) {
      clipboard = next;
    },
    setGranted(permissions) {
      const next = new Set(permissions);
      const unchanged =
        next.size === granted.size && [...next].every((permission) => granted.has(permission));
      granted = next;
      // Like setLanguage: only a real change reaches a subscribed Plugin, so
      // recording the same set again costs no event.
      if (!unchanged) broker.emit("permissions.changed", { permissions: [...granted] });
    },
    setLanguage(next) {
      language = next;
      broker.emit("language.changed", { language });
    },
    setEndpointAddress(port) {
      const next: EndpointListenerState =
        port === null ? { state: "off" } : { state: "listening", port };
      const before = endpointUrlFor(endpointState, options.manifest.id);
      endpointState = next;
      const after = endpointUrlFor(next, options.manifest.id);
      if (after !== before) broker.emit("endpoint.addressChanged", { url: after });
    },
    setLibraryAvailable(available) {
      libraryAvailable = available;
    },
    setPendingEdit(chapterId, html) {
      pendingEdits.set(chapterId, html);
    },
    endpoint,
    endpointStream,
    renderPage(page: string) {
      return renderSurface(page, "page");
    },
    renderSettingsRow(rowId: string) {
      return renderSurface(rowId, "settingsRow");
    },
    stopWorker() {
      broker.stop("requested");
      // Sever every mount so no mutation or echo can arrive, but leave the
      // host renderer mounted: a stopped Worker leaves a host tree behind.
      for (const { mount, thread } of openMounts.values()) {
        thread.close();
        mount.port.close();
      }
    },
    stop() {
      for (const page of [...openPages]) page.unmount();
      broker.stop("requested");
      channel.port1.close();
      channel.port2.close();
    },
  };
}
