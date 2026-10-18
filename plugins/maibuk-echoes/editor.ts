/**
 * Echoes' editor controller (#451, unit 3): the behavior behind the three
 * editor Commands. `Toggle echo highlights` turns highlighting on for the
 * focused editor and recomputes it after each coalesced typing burst;
 * `Next echo` and `Previous echo` step through the Plugin's own range list and
 * reveal the caret, wrapping at both ends. It also exposes `refresh`, the
 * recompute the Settings row triggers after it changes a kind.
 *
 * It is created with the Plugin client and answers `command.run` through
 * `runtime.tsx`, so it is kept apart from the report page and Settings row: a
 * test drives it over a fake client, with no Worker, host, or live editor.
 *
 * One switch covers every editor (Chapter, Note, Ephemeral). It is stored in the
 * Plugin's storage, read at startup, and changed only by an explicit toggle, so
 * it survives editor switches, app restarts, and Plugin stops. Focus moving to
 * another editor keeps it on and paints that editor; an editor closing keeps it
 * on too, and the next editor to take focus is painted. Only the kinds the
 * author enabled in Settings are painted (nearby by default); a
 * nearby echo paints both of its words. Detection runs in the language the
 * host reports with the editor's content (spec line 15, ADR 0030): a Note's own
 * else its Book's, a Chapter's Book's, the Ephemeral's Spell Check language;
 * the app's UI language only when that is blank. It is read on every recompute,
 * so a language switch while highlighting is on re-detects. Labels and
 * announcements stay in the app's UI language; nothing here reads the host's
 * i18n — they come from the Plugin's own catalog, through `createEchoTranslator`.
 *
 * Imports only `@/plugin-sdk` types and this Plugin's files.
 */

import type { PluginApiEventId, PluginApiEvents, PluginClient } from "@/plugin-sdk";
import { type EchoPaletteId } from "./colors";
import { findEchoesWithTokens } from "./find-echoes";
import {
  ECHO_HIGHLIGHT_KINDS,
  ECHO_PAINT_LIMIT,
  type EchoHighlightSets,
  type EchoNavigationEntry,
  type EchoTranslate,
  type PluginEchoHighlightKind,
  buildEchoList,
  createEchoTranslator,
  echoAnnouncement,
  echoHighlightSets,
  echoHighlightsOff,
  echoNoEchoes,
  paintWindow,
  stepFrom,
} from "./highlights";
import {
  readColorByEcho,
  readEchoPalette,
  readEchoesSettings,
  readEditorKinds,
  readHighlightsOn,
  toEditorFindOptions,
  writeHighlightsOn,
} from "./settings";

/**
 * The bench ring for Echoes' own recompute time (#451): the last
 * `RECOMPUTE_RING_MAX` durations of `findEchoes` + building and labelling the
 * painted window, in ms. The `bench:plugins` lane reads it from the Plugin
 * Worker global (`globalThis.__maibukEchoesRecomputeMs`). A Plugin cannot read
 * the host's `benchMarksEnabled()` gate, so this stays always on but cheap: one
 * `performance.now()` pair and a fixed-length array per recompute, and at most
 * one `performance.measure` on the Worker's own timeline at a time.
 */
const RECOMPUTE_RING_MAX = 200;
const RECOMPUTE_MEASURE = "echoes.recompute";
const recomputeDurations: number[] = [];
(globalThis as unknown as { __maibukEchoesRecomputeMs?: number[] }).__maibukEchoesRecomputeMs =
  recomputeDurations;

/** A monotonic timestamp, or 0 where the clock is unavailable. */
function nowMs(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;
}

/** Records one recompute's duration, ring-bounded and readable by the bench (#451). */
function recordRecompute(startedAt: number): void {
  const endedAt = nowMs();
  recomputeDurations.push(endedAt - startedAt);
  if (recomputeDurations.length > RECOMPUTE_RING_MAX) recomputeDurations.shift();
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    // Keep the Worker's timeline bounded (one measure, not one per recompute);
    // the ring above is the bench's source of the recent samples.
    performance.clearMeasures?.(RECOMPUTE_MEASURE);
    performance.measure(RECOMPUTE_MEASURE, { start: startedAt, end: endedAt });
  } catch {
    // Timing must never break a recompute.
  }
}

/** The slice of the SDK client the controller uses. */
export interface EchoEditorClient {
  editor: Pick<PluginClient["editor"], "getContent" | "getSelection" | "reveal" | "setHighlights">;
  notifications: Pick<PluginClient["notifications"], "show">;
  toolbar: Pick<PluginClient["toolbar"], "setPressed">;
  language: Pick<PluginClient["language"], "get">;
  storage: Pick<PluginClient["storage"], "get" | "set" | "delete" | "keys">;
  on: PluginClient["on"];
}

/** The focused editor's content read, as the SDK returns it. */
type ContentResult = Awaited<ReturnType<EchoEditorClient["editor"]["getContent"]>>;

/** The focused editor's content read, when there is a target editor. */
type ContentOk = Extract<ContentResult, { status: "ok" }>;

/** The entity a focused editor is bound to. */
type EntityTarget = ContentOk["entity"];

/** The focused editor's caret read, as the SDK returns it. */
type SelectionResult = Awaited<ReturnType<EchoEditorClient["editor"]["getSelection"]>>;

/** The three editor Commands the controller answers, plus its Settings refresh. */
export interface EchoEditorController {
  toggleHighlights(): Promise<void>;
  nextEcho(): Promise<void>;
  previousEcho(): Promise<void>;
  /**
   * Recomputes the open editor after the Settings row changes a kind, so a
   * switch takes effect on the editor at once, not on its next edit. A no-op
   * while highlighting is off.
   */
  refresh(): Promise<void>;
}

/** The controller's own state; off until the author toggles it on. */
interface EchoEditorState {
  on: boolean;
  entity: EntityTarget | null;
  /** The full navigation list Next/Previous step through (decision 7). */
  list: readonly EchoNavigationEntry[];
  /** The `[start, end)` slice of `list` the host currently shows (decision 7). */
  window: { start: number; end: number };
  /** Whether each host kind is currently empty, so an unchanged empty kind is not re-sent. */
  empty: Record<PluginEchoHighlightKind, boolean>;
  /** The last index Next/Previous moved to, for the no-selection fallback. */
  index: number | null;
  /** The app's UI language, for labels and announcements. */
  uiLanguage: string;
  /** The language detection runs in, as the host last reported it. */
  detectionLanguage: string;
}

function sameEntity(a: EntityTarget, b: EntityTarget): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** A language tag, or null when it is missing or blank. */
function languageOrNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
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
    window: { start: 0, end: 0 },
    empty: { repetition: false, info: false, warning: false },
    index: null,
    uiLanguage: "en",
    detectionLanguage: "en",
  };

  // Bumped on every focus event, with the entity it reported last. A toggle
  // that awaited the focused editor checks both after its read (#529).
  let focusEpoch = 0;
  let lastFocused: EntityTarget | null = null;

  // Set by the first explicit toggle. The startup read of the stored switch is
  // ignored once the author has acted, so an explicit toggle always wins (#534).
  let toggledByAuthor = false;

  // Coalescing: one recompute runs at a time; a change that arrives while one
  // is in flight is remembered and runs exactly one more time afterwards.
  let running = false;
  let pending = false;

  const translate = (): EchoTranslate => createEchoTranslator(state.uiLanguage);

  /** The language to detect in: the one the host reported, else the app's. */
  function detectionLanguageOf(content: ContentOk): string {
    return languageOrNull(content.language) ?? state.uiLanguage;
  }

  async function notify(message: string): Promise<void> {
    try {
      await client.notifications.show({ variant: "info", message });
    } catch {
      // A refused toast is not worth failing the Command over.
    }
  }

  /**
   * Replaces this Plugin's set of each kind in the focused editor. The three
   * kinds are dispatched concurrently (#451, decision 7). When `entity` is
   * given, a paint that finds a different editor focused — focus moved
   * mid-recompute — stops, so the newly focused editor is never painted with the
   * previous one's ranges. Unless `force`, a kind that is empty and was already
   * empty in the previous paint is left alone (still cleared by `force`).
   */
  async function paint(
    sets: EchoHighlightSets,
    entity?: EntityTarget,
    force = false
  ): Promise<void> {
    if (
      entity !== undefined &&
      (!state.on || state.entity === null || !sameEntity(state.entity, entity))
    ) {
      return;
    }
    const tasks: Promise<void>[] = [];
    for (const kind of ECHO_HIGHLIGHT_KINDS) {
      const ranges = sets[kind];
      const isEmpty = ranges.length === 0;
      if (!force && isEmpty && state.empty[kind]) continue;
      state.empty[kind] = isEmpty;
      tasks.push(
        (async () => {
          try {
            await client.editor.setHighlights({ kind, ranges: [...ranges] });
          } catch {
            // The editor may have lost focus between reads; leave it to the next event.
          }
        })()
      );
    }
    await Promise.all(tasks);
  }

  /** Reads the detection settings, the kinds the editor paints, and the color switch. */
  async function enabledKinds(): Promise<{
    settings: Awaited<ReturnType<typeof readEchoesSettings>>;
    kinds: Awaited<ReturnType<typeof readEditorKinds>>;
    colors: boolean;
    palette: EchoPaletteId;
  }> {
    const [settings, kinds, colors, palette] = await Promise.all([
      readEchoesSettings(client),
      readEditorKinds(client),
      readColorByEcho(client),
      readEchoPalette(client),
    ]);
    return { settings, kinds, colors, palette };
  }

  /**
   * Detects against one editor's text, paints the window of its enabled kinds
   * centered on `caret`, and stores the full list (#451, decision 7). Only the
   * enabled kinds are detected, and only the window's ranges are labelled.
   */
  async function apply(text: string, entity: EntityTarget, caret: number): Promise<void> {
    const { settings, kinds, colors, palette } = await enabledKinds();
    if (!state.on || state.entity === null || !sameEntity(state.entity, entity)) return;
    const t = translate();
    // Time only Echoes' own compute (findEchoes + building and labelling the
    // painted window) for the Worker-recompute bench row (#451); no await runs
    // inside this span.
    const startedAt = nowMs();
    const { echoes, chapters } = findEchoesWithTokens(
      text,
      state.detectionLanguage,
      toEditorFindOptions(settings, kinds)
    );
    const list = buildEchoList(echoes, kinds, text, chapters);
    const { start, end } = paintWindow(list, caret, ECHO_PAINT_LIMIT);
    const sets = echoHighlightSets(list.slice(start, end), t, { colors, palette });
    recordRecompute(startedAt);
    await paint(sets, entity);
    if (!state.on || state.entity === null || !sameEntity(state.entity, entity)) return;
    state.list = list;
    state.window = { start, end };
  }

  /** One coalesced recompute of the highlighted entity's highlights. */
  async function recomputeOnce(): Promise<void> {
    // The caret is read alongside the content, so the paint can center on it
    // without a further round trip (#451, decision 7).
    const [content, selection] = await Promise.all([
      client.editor.getContent(),
      client.editor.getSelection(),
    ]);
    if (content.status !== "ok") return;
    if (!state.on || state.entity === null || !sameEntity(content.entity, state.entity)) return;
    const caret = selection.status === "ok" ? selection.range.from : 0;
    state.detectionLanguage = detectionLanguageOf(content);
    await apply(content.content.text, content.entity, caret);
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
    await paint({ repetition: [], info: [], warning: [] }, undefined, true);
  }

  /**
   * Sets highlighting on or off and shows the Toggle Button to match. Every
   * change to `state.on` goes through here, so the button never lags the state.
   */
  function setOn(value: boolean): void {
    state.on = value;
    void client.toolbar.setPressed({ button: "toggleHighlights", pressed: value }).catch(() => {});
  }

  /**
   * Forgets the focused editor without touching the switch, the button, or the
   * host: the next editor to take focus starts from nothing.
   */
  function forget(): void {
    state.entity = null;
    state.list = [];
    state.window = { start: 0, end: 0 };
    state.index = null;
    state.empty = { repetition: false, info: false, warning: false };
  }

  /** Switches off and forgets the focused editor, without touching the host. */
  function resetState(): void {
    setOn(false);
    forget();
  }

  /** Switches off and clears every kind from the still-focused editor. */
  function turnOff(): Promise<void> {
    resetState();
    return clear();
  }

  /**
   * Points the controller at `content`'s editor and paints it with the enabled
   * kinds. The shared paint path of the explicit toggle, startup, and a focus
   * change to an editor while the switch is on.
   */
  async function activate(content: ContentOk, selection: SelectionResult): Promise<void> {
    forget();
    state.entity = content.entity;
    state.detectionLanguage = detectionLanguageOf(content);
    const caret = selection.status === "ok" ? selection.range.from : 0;
    await apply(content.content.text, content.entity, caret);
  }

  /**
   * The focused editor's content and caret, or null when no editor is focused
   * or focus moved to another entity during the read.
   */
  async function readFocused(): Promise<{ content: ContentOk; selection: SelectionResult } | null> {
    const epoch = focusEpoch;
    const [content, selection] = await Promise.all([
      client.editor.getContent(),
      client.editor.getSelection(),
    ]);
    if (content.status !== "ok") return null;
    // A focus event during the read aborts only when it moved focus away
    // from the editor read: the same entity re-announced is not a move (#529).
    if (
      focusEpoch !== epoch &&
      (lastFocused === null || !sameEntity(lastFocused, content.entity))
    ) {
      return null;
    }
    return { content, selection };
  }

  /**
   * Repaints the window centered on a revealed entry that falls outside it
   * (#451, decision 7), through the same paint path as a recompute.
   */
  async function repaintAround(index: number): Promise<void> {
    if (!state.on || state.entity === null) return;
    const caret = state.list[index]?.from ?? 0;
    const { start, end } = paintWindow(state.list, caret, ECHO_PAINT_LIMIT);
    state.window = { start, end };
    const sets = echoHighlightSets(state.list.slice(start, end), translate());
    await paint(sets, state.entity);
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
    // selection to read, or the caret still sits on the entry just stepped to,
    // the step goes from the stored index (see `stepFrom`).
    const caret = selection.status === "ok" ? selection.range.from : null;
    const index = stepFrom(state.list, caret, direction, state.index);
    if (index === null) return;
    state.index = index;
    const entry = state.list[index];
    await client.editor.reveal({ range: { from: entry.from, to: entry.to } });
    // The full list is walked; the window follows when the entry leaves it.
    if (index < state.window.start || index >= state.window.end) await repaintAround(index);
    await notify(echoAnnouncement(state.list, index, t));
  }

  // A stale null can arrive while the same editor is still focused (#529), so
  // forget the editor only when the host confirms no editor has focus on it. The
  // switch stays on and pressed: the next editor to take focus is painted.
  async function closeIfNoEditor(): Promise<void> {
    if (state.entity === null) return;
    const epoch = focusEpoch;
    const content = await client.editor.getContent().catch(() => null);
    // Any focus event since the null arrived supersedes its answer.
    if (focusEpoch !== epoch) return;
    if (
      content !== null &&
      content.status === "ok" &&
      state.entity !== null &&
      sameEntity(content.entity, state.entity)
    ) {
      return;
    }
    forget();
  }

  /**
   * Moves the paint from the previous editor to `entity`, the newly focused one
   * (#534). The previous editor's paint is cleared, then the new editor is
   * painted, unless focus moved again, the switch went off, or the content read
   * is not for `entity`.
   */
  async function switchTo(entity: EntityTarget, epoch: number): Promise<void> {
    const previous = state.entity;
    // Forget first: a change to the old entity that lands during the clear must
    // not repaint it, and the new editor must not inherit its ranges.
    forget();
    if (previous !== null) await clear();
    const [content, selection] = await Promise.all([
      client.editor.getContent(),
      client.editor.getSelection(),
    ]);
    if (focusEpoch !== epoch || !state.on || state.entity !== null) return;
    if (content.status !== "ok" || !sameEntity(content.entity, entity)) return;
    await activate(content, selection);
  }

  /**
   * Startup (#534): when the stored switch is on, presses the Toggle Button and
   * paints the focused editor if there is one. With no editor, the next non-null
   * focus paints. A read that resolves after an explicit toggle is ignored.
   */
  async function restore(): Promise<void> {
    const on = await readHighlightsOn(client);
    if (!on || toggledByAuthor) return;
    setOn(true);
    const focused = await readFocused();
    if (focused === null || !state.on || state.entity !== null) return;
    await activate(focused.content, focused.selection);
  }

  function listen<E extends PluginApiEventId>(
    event: E,
    handler: (payload: PluginApiEvents[E]) => void | Promise<void>
  ): void {
    void client.on(event, handler).catch(() => {});
  }

  listen("editor.contentChanged", (payload) => {
    if (!state.on || state.entity === null || !sameEntity(payload.entity, state.entity)) return;
    return recompute();
  });

  listen("editor.focusChanged", (payload) => {
    focusEpoch++;
    const epoch = focusEpoch;
    lastFocused = payload.entity;
    // The host reports `null` when the focused editor unmounts or a stale null
    // arrives after a toggle (a mere blur to a toolbar button or a Plugin page
    // keeps the target). A null only asks for a check: `closeIfNoEditor` forgets
    // the editor when the host confirms no editor is focused on it. The switch
    // stays on, and a later editor must never inherit this one's ranges (#451, #529).
    if (payload.entity === null) {
      return closeIfNoEditor();
    }
    // A non-null entity while the switch is on paints that editor. A different
    // one first clears the previous editor's paint (#534).
    if (!state.on || (state.entity !== null && sameEntity(payload.entity, state.entity))) return;
    return switchTo(payload.entity, epoch);
  });

  listen("language.changed", (payload) => {
    state.uiLanguage = payload.language;
    return recompute();
  });

  void client.language
    .get()
    .then((value) => {
      state.uiLanguage = value.language;
    })
    .catch(() => {});

  void restore().catch(() => {});

  return {
    async toggleHighlights() {
      toggledByAuthor = true;
      try {
        if (state.on) {
          await turnOff();
          await writeHighlightsOn(client, false);
          return;
        }
        // The caret comes with the content, so the first paint centers on it
        // without an extra round trip (#451, decision 7).
        const focused = await readFocused();
        if (focused === null) return;
        setOn(true);
        await activate(focused.content, focused.selection);
        // Best-effort: a refused write leaves the switch working in memory (#534).
        await writeHighlightsOn(client, true);
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

    async refresh() {
      await recompute();
    },
  };
}
