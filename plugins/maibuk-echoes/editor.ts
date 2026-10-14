/**
 * Echoes' editor controller (#451, unit 3): the behavior behind the three
 * editor Commands. `Toggle echo highlights` turns highlighting on for the
 * focused editor and recomputes it after each coalesced typing burst;
 * `Next echo` and `Previous echo` step through the Plugin's own range list and
 * reveal the caret, wrapping at both ends.
 *
 * It is created with the Plugin client and answers `command.run` through
 * `runtime.tsx`, so it is kept apart from the report page and Settings row: a
 * test drives it over a fake client, with no Worker, host, or live editor.
 *
 * State lives for the Plugin activation and starts off each time. Only the
 * kinds the author enabled in Settings are painted (nearby by default); a
 * nearby echo paints both of its words. Detection runs in the entity's own
 * language (spec line 15): a Chapter's Book's language, a Note's own language
 * else its Book's, a Book's own, otherwise the app's UI language. Labels and
 * announcements stay in the app's UI language; nothing here reads the host's
 * i18n — they come from the Plugin's own catalog, through `createEchoTranslator`.
 *
 * Imports only `@/plugin-sdk` types and this Plugin's files.
 */

import type { PluginApiEventId, PluginApiEvents, PluginClient } from "@/plugin-sdk";
import { findEchoes } from "./find-echoes";
import {
  ECHO_HIGHLIGHT_KINDS,
  type EchoHighlightSets,
  type EchoNavigationEntry,
  type EchoTranslate,
  createEchoTranslator,
  echoAnnouncement,
  echoHighlightRanges,
  echoHighlightsOff,
  echoNavigationList,
  echoNoEchoes,
  stepEcho,
} from "./highlights";
import { readEchoesSettings, readEditorKinds, toFindEchoesOptions } from "./settings";

/** The slice of the SDK client the controller uses. */
export interface EchoEditorClient {
  editor: Pick<PluginClient["editor"], "getContent" | "getSelection" | "reveal" | "setHighlights">;
  library: {
    books: Pick<PluginClient["library"]["books"], "get">;
    chapters: Pick<PluginClient["library"]["chapters"], "get">;
    notes: Pick<PluginClient["library"]["notes"], "get">;
  };
  notifications: Pick<PluginClient["notifications"], "show">;
  language: Pick<PluginClient["language"], "get">;
  storage: Pick<PluginClient["storage"], "get" | "set" | "delete" | "keys">;
  on: PluginClient["on"];
}

/** The focused editor's content read, as the SDK returns it. */
type ContentResult = Awaited<ReturnType<EchoEditorClient["editor"]["getContent"]>>;

/** The entity a focused editor is bound to. */
type EntityTarget = Extract<ContentResult, { status: "ok" }>["entity"];

/** The three editor Commands the controller answers. */
export interface EchoEditorController {
  toggleHighlights(): Promise<void>;
  nextEcho(): Promise<void>;
  previousEcho(): Promise<void>;
}

/** The controller's own state; off until the author toggles it on. */
interface EchoEditorState {
  on: boolean;
  entity: EntityTarget | null;
  list: readonly EchoNavigationEntry[];
  /** The last index Next/Previous moved to, for the no-selection fallback. */
  index: number | null;
  /** The app's UI language, for labels and announcements. */
  uiLanguage: string;
  /** The language detection runs in, resolved for the entity at toggle-on. */
  detectionLanguage: string;
}

function sameEntity(a: EntityTarget, b: EntityTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A language tag, or null when it is missing or blank. */
function languageOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The index Next echo moves to: the first entry past the caret, else the first. */
function nextFrom(list: readonly EchoNavigationEntry[], caret: number): number {
  const index = list.findIndex((entry) => entry.from > caret);
  return index === -1 ? 0 : index;
}

/** The index Previous echo moves to: the last entry before the caret, else the last. */
function previousFrom(list: readonly EchoNavigationEntry[], caret: number): number {
  for (let index = list.length - 1; index >= 0; index--) {
    if (list[index].from < caret) return index;
  }
  return list.length - 1;
}

/**
 * Creates the editor controller for one Plugin activation and starts listening
 * for `editor.contentChanged`, `editor.focusChanged`, and `language.changed`.
 */
export function createEchoEditor(client: EchoEditorClient): EchoEditorController {
  const state: EchoEditorState = {
    on: false,
    entity: null,
    list: [],
    index: null,
    uiLanguage: "en",
    detectionLanguage: "en",
  };

  // Coalescing: one recompute runs at a time; a change that arrives while one
  // is in flight is remembered and runs exactly one more time afterwards.
  let running = false;
  let pending = false;

  const translate = (): EchoTranslate => createEchoTranslator(state.uiLanguage);

  /** The Book's language, or null when the Book is absent or carries none. */
  async function bookLanguageOf(bookId: string): Promise<string | null> {
    const book = await client.library.books.get({ bookId });
    return languageOrNull(book?.language);
  }

  /**
   * The language detection runs in (spec line 15): a Chapter's Book's language;
   * a Note's own language, else its Book's; a Book's own language; otherwise the
   * app's UI language. A Canvas has no language. Resolved once per toggle-on.
   */
  async function resolveDetectionLanguage(entity: EntityTarget): Promise<string> {
    const fallback = state.uiLanguage;
    try {
      if (entity.kind === "note") {
        const note = await client.library.notes.get({ noteId: entity.id });
        const own = languageOrNull(note?.language);
        if (own !== null) return own;
        const bookId = note?.bookId;
        return (bookId === null || bookId === undefined ? null : await bookLanguageOf(bookId)) ?? fallback;
      }
      if (entity.kind === "chapter") {
        const chapter = await client.library.chapters.get({ chapterId: entity.id });
        return (chapter === null ? null : await bookLanguageOf(chapter.bookId)) ?? fallback;
      }
      if (entity.kind === "book") {
        return (await bookLanguageOf(entity.id)) ?? fallback;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  async function notify(message: string): Promise<void> {
    try {
      await client.notifications.show({ variant: "info", message });
    } catch {
      // A refused toast is not worth failing the Command over.
    }
  }

  /**
   * Replaces this Plugin's set of each kind in the focused editor. When
   * `entity` is given, a paint that finds a different editor focused — focus
   * moved mid-recompute — stops, so the newly focused editor is never painted
   * with the previous one's ranges.
   */
  async function paint(sets: EchoHighlightSets, entity?: EntityTarget): Promise<void> {
    for (const kind of ECHO_HIGHLIGHT_KINDS) {
      if (entity !== undefined && (!state.on || state.entity === null || !sameEntity(state.entity, entity))) {
        return;
      }
      try {
        await client.editor.setHighlights({ kind, ranges: [...sets[kind]] });
      } catch {
        // The editor may have lost focus between reads; leave it to the next event.
      }
    }
  }

  /** Reads the detection settings and the kinds the editor paints. */
  async function enabledKinds(): Promise<{
    settings: Awaited<ReturnType<typeof readEchoesSettings>>;
    kinds: Awaited<ReturnType<typeof readEditorKinds>>;
  }> {
    const [settings, kinds] = await Promise.all([
      readEchoesSettings(client),
      readEditorKinds(client),
    ]);
    return { settings, kinds };
  }

  /** Detects against one editor's text, paints its enabled kinds, and stores the list. */
  async function apply(text: string, entity: EntityTarget): Promise<void> {
    const { settings, kinds } = await enabledKinds();
    if (!state.on) return;
    const t = translate();
    const echoes = findEchoes(text, state.detectionLanguage, toFindEchoesOptions(settings));
    const sets = echoHighlightRanges(echoes, kinds, t, text);
    await paint(sets, entity);
    if (!state.on || state.entity === null || !sameEntity(state.entity, entity)) return;
    state.list = echoNavigationList(sets);
  }

  /** One coalesced recompute of the highlighted entity's highlights. */
  async function recomputeOnce(): Promise<void> {
    const content = await client.editor.getContent();
    if (content.status !== "ok") return;
    if (!state.on || state.entity === null || !sameEntity(content.entity, state.entity)) return;
    await apply(content.content.text, content.entity);
  }

  async function recompute(): Promise<void> {
    if (!state.on) return;
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        await recomputeOnce();
      } while (pending && state.on);
    } finally {
      running = false;
    }
  }

  /** Sends empty ranges for every kind, so no stale highlight is left behind. */
  async function clear(): Promise<void> {
    await paint({ repetition: [], info: [], warning: [] });
  }

  function turnOff(): Promise<void> {
    state.on = false;
    state.entity = null;
    state.list = [];
    state.index = null;
    return clear();
  }

  async function step(direction: "next" | "previous"): Promise<void> {
    const t = translate();
    if (!state.on) {
      await notify(echoHighlightsOff(t));
      return;
    }
    if (state.list.length === 0) {
      await notify(echoNoEchoes(t));
      return;
    }
    const selection = await client.editor.getSelection();
    // A caret inside the editor picks the neighbouring Echo; when there is no
    // selection to read, step from where the last one landed.
    // A caret still on the last revealed Echo steps by index, so Echoes of two
    // kinds that start at the same offset are each visited.
    const onLast =
      selection.status === "ok" &&
      state.index !== null &&
      state.list[state.index]?.from === selection.range.from;
    const index =
      selection.status === "ok" && !onLast
        ? direction === "next"
          ? nextFrom(state.list, selection.range.from)
          : previousFrom(state.list, selection.range.from)
        : stepEcho(state.list, state.index, direction);
    if (index === null) return;
    state.index = index;
    const entry = state.list[index];
    await client.editor.reveal({ range: { from: entry.from, to: entry.to } });
    await notify(echoAnnouncement(state.list, index, t));
  }

  function listen<E extends PluginApiEventId>(
    event: E,
    handler: (payload: PluginApiEvents[E]) => void
  ): void {
    void client.on(event, handler).catch(() => {});
  }

  listen("editor.contentChanged", (payload) => {
    if (!state.on || state.entity === null || !sameEntity(payload.entity, state.entity)) return;
    void recompute();
  });

  listen("editor.focusChanged", (payload) => {
    // Losing focus to a toolbar button or a Plugin page keeps the target; only a
    // different, non-null entity turns highlighting off.
    if (payload.entity === null) return;
    if (!state.on || state.entity === null || sameEntity(payload.entity, state.entity)) return;
    void turnOff();
  });

  listen("language.changed", (payload) => {
    state.uiLanguage = payload.language;
    void recompute();
  });

  void client.language
    .get()
    .then((value) => {
      state.uiLanguage = value.language;
    })
    .catch(() => {});

  return {
    async toggleHighlights() {
      try {
        if (state.on) {
          await turnOff();
          return;
        }
        const content = await client.editor.getContent();
        if (content.status !== "ok") return;
        state.on = true;
        state.entity = content.entity;
        state.index = null;
        state.list = [];
        state.detectionLanguage = await resolveDetectionLanguage(content.entity);
        await apply(content.content.text, content.entity);
        if (state.on && state.list.length === 0) await notify(echoNoEchoes(translate()));
      } catch {
        // Keep the controller alive; the next toggle retries.
      }
    },

    async nextEcho() {
      try {
        await step("next");
      } catch {
        // A refused editor call is not worth failing the Command over.
      }
    },

    async previousEcho() {
      try {
        await step("previous");
      } catch {
        // A refused editor call is not worth failing the Command over.
      }
    },
  };
}
