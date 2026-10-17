/**
 * Echoes' editor controller (#451, unit 3): Toggle echo highlights, Next echo,
 * and Previous echo, driven over a fake Plugin client shaped like the SDK. The
 * editor API and its events are not part of `createTestHost`, so this suite
 * exercises the controller directly — no Worker, host, or live editor.
 *
 * The fake records every `editor.setHighlights`, `editor.reveal`, and
 * `notifications.show`, and lets a test gate `editor.getContent` so the
 * coalescing rule can be observed deterministically.
 */

import { describe, expect, it, vi } from "vitest";
import type { PluginApiEventId, PluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { createEchoEditor, type EchoEditorClient } from "./editor";
import { ECHO_PAINT_LIMIT } from "./highlights";
import {
  NEXT_ECHO,
  PREVIOUS_ECHO,
  TOGGLE_HIGHLIGHTS,
  type EchoServe,
  startEchoes,
} from "./runtime";
import { ECHOES_EDITOR_KEY } from "./settings";

/** One recorded `editor.setHighlights` call. */
interface HighlightCall {
  kind: string;
  ranges: Array<{ from: number; to: number; label?: string }>;
}

/** One recorded `notifications.show` call. */
interface NotificationCall {
  variant: string;
  message: string;
}

type Listener = (payload: unknown) => void;

/** Two occurrences of "door" four words apart: one nearby echo, two ranges. */
const DOOR = "A door creaked. Then a door slammed.";
/** A word repeated five times: five nearby ranges (and an overused group). */
const DOORS = "door door door door door";
/** No repetition, no overuse, no phrase: an empty result. */
const PLAIN = "Nothing echoes in this plain sentence.";
/**
 * "para" is a Spanish stop word but not an English one, so it echoes under en
 * and is silent under es — a text that tells the two detection languages apart.
 */
const PARA = "para para para para para";

interface FakeOptions {
  /** The focused editor's text (a Chapter is one string). */
  text?: string;
  /** The entity the focused editor is bound to. */
  id?: string;
  /** The kind of editor: a Chapter, or a Note. */
  kind?: "chapter" | "note";
  /** The caret the editor reports, or null for a no-target selection. */
  selection?: { from: number; to: number } | null;
  /** The language of the entity's Book. */
  bookLanguage?: string;
  /** A Note's own language, or null (then its Book's language is used). */
  noteLanguage?: string | null;
  /** The editor highlight kinds to store (unset leaves the nearby-only default). */
  editorKinds?: readonly string[];
}

function fakeClient(options: FakeOptions = {}) {
  const kind = options.kind ?? "chapter";
  const entity = {
    kind,
    id: options.id ?? (kind === "note" ? "n1" : "c1"),
  } as { kind: "chapter" | "note"; id: string };
  const text = options.text ?? DOOR;
  const storage = new Map<string, unknown>();
  if (options.editorKinds !== undefined) storage.set(ECHOES_EDITOR_KEY, [...options.editorKinds]);
  const listeners = new Map<string, Set<Listener>>();
  const highlights: HighlightCall[] = [];
  const reveals: Array<{ from: number; to: number }> = [];
  const notifications: NotificationCall[] = [];
  const pressed: boolean[] = [];

  // A minimal Library: one Book whose language the options set, one Chapter in
  // it, and one Note that may carry its own language.
  const bookLanguage = options.bookLanguage ?? "en";
  const books: Record<string, string> = { b1: bookLanguage };
  const chapters: Record<string, string> = { c1: "b1" };
  const notes: Record<string, { bookId: string | null; language: string | null }> = {
    n1: { bookId: "b1", language: options.noteLanguage ?? null },
  };

  let selection = options.selection === undefined ? { from: 0, to: 0 } : options.selection;
  let getContentCalls = 0;
  let gate: Promise<void> | null = null;

  const client: EchoEditorClient = {
    editor: {
      async getContent() {
        getContentCalls++;
        if (gate !== null) await gate;
        return { status: "ok", entity, content: { text, html: `<p>${text}</p>` } };
      },
      async getSelection() {
        return selection === null
          ? { status: "no-target" }
          : { status: "ok", entity, range: selection, text: "" };
      },
      async reveal({ range }) {
        reveals.push({ from: range.from, to: range.to });
        return { status: "applied" };
      },
      async setHighlights({ kind, ranges }) {
        highlights.push({ kind, ranges: ranges.map((range) => ({ ...range })) });
        return { status: "applied" };
      },
    },
    library: {
      books: {
        async get({ bookId }) {
          const language = books[bookId];
          return language === undefined
            ? null
            : {
                id: bookId,
                title: "Book",
                subtitle: null,
                authorName: "Author",
                language,
                wordCount: 0,
                updatedAt: 0,
              };
        },
      },
      chapters: {
        async get({ chapterId }) {
          const bookId = chapters[chapterId];
          return bookId === undefined
            ? null
            : {
                id: chapterId,
                bookId,
                title: "Chapter",
                order: 0,
                parentId: null,
                wordCount: 0,
                updatedAt: 0,
                content: { text: "", html: "" },
              };
        },
      },
      notes: {
        async get({ noteId }) {
          const note = notes[noteId];
          return note === undefined
            ? null
            : {
                id: noteId,
                bookId: note.bookId,
                title: "Note",
                language: note.language,
                tags: [],
                wordCount: 0,
                updatedAt: 0,
                content: { text: "", html: "" },
              };
        },
      },
    },
    notifications: {
      async show({ variant, message }) {
        notifications.push({ variant, message });
        return null;
      },
    },
    toolbar: {
      async setPressed({ button, pressed: value }) {
        if (button !== "toggleHighlights") throw new Error(`unexpected button ${button}`);
        pressed.push(value);
        return null;
      },
    },
    language: {
      async get() {
        return { language: "en" };
      },
    },
    storage: {
      async get({ key }) {
        return storage.get(key) ?? null;
      },
      async set({ key, value }) {
        storage.set(key, value);
        return null;
      },
      async delete({ key }) {
        storage.delete(key);
        return null;
      },
      async keys() {
        return [...storage.keys()];
      },
    },
    on: ((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>();
      listeners.set(event, set);
      set.add(listener);
      return Promise.resolve(async () => {
        set.delete(listener);
      });
    }) as unknown as PluginClient["on"],
  };

  return {
    client,
    entity,
    highlights,
    reveals,
    notifications,
    /** Every `toolbar.setPressed` value the controller sent, in order. */
    pressed,
    getContentCalls: () => getContentCalls,
    setSelection(next: { from: number; to: number } | null) {
      selection = next;
    },
    /** Makes every later `editor.getContent` wait for the returned release. */
    gateContent(): () => void {
      let release!: () => void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
    emit(event: PluginApiEventId, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

/**
 * A Chapter of `count` "echo" words, each five characters apart (one per word),
 * so the text is a single nearby chain of `count` ranges. Offsets: word `i` runs
 * from `i * 5` to `i * 5 + 4` (#451, decision 7).
 */
function repeatedEchoText(count: number): string {
  return "echo ".repeat(count).trimEnd();
}

const kindsOf = (calls: readonly HighlightCall[]): string[] => calls.map((call) => call.kind);

describe("toggleHighlights() Toggle Button state", () => {
  it("sets the Toggle Button pressed when highlights turn on, and back off when they turn off", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();
    expect(fake.pressed).toEqual([true]);

    await controller.toggleHighlights();
    expect(fake.pressed).toEqual([true, false]);
  });

  it("tracks every flip, however many times the author toggles", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();
    await controller.toggleHighlights();
    await controller.toggleHighlights();

    expect(fake.pressed).toEqual([true, false, true]);
  });
});

describe("toggleHighlights()", () => {
  it("turns on all three kinds with nearby only by default", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();

    expect(kindsOf(fake.highlights)).toEqual(["repetition", "info", "warning"]);
    const [repetition, info, warning] = fake.highlights;
    expect(repetition.ranges.length).toBeGreaterThan(0);
    expect(info.ranges).toEqual([]);
    expect(warning.ranges).toEqual([]);
    expect(fake.notifications).toEqual([]);
  });

  it("clears every kind when toggled off", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();
    await controller.toggleHighlights();

    const cleared = fake.highlights.slice(-3);
    expect(kindsOf(cleared)).toEqual(["repetition", "info", "warning"]);
    expect(cleared.every((call) => call.ranges.length === 0)).toBe(true);
  });

  it("does nothing when no editor is focused", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    // No focused editor: report no-target by replacing getContent.
    fake.client.editor.getContent = async () => ({ status: "no-target" });

    await controller.toggleHighlights();

    expect(fake.highlights).toEqual([]);
    expect(fake.notifications).toEqual([]);
  });

  it("announces no echoes when the enabled kinds find none", async () => {
    const fake = fakeClient({ text: PLAIN });
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();

    expect(fake.highlights.every((call) => call.ranges.length === 0)).toBe(true);
    expect(fake.notifications).toEqual([{ variant: "info", message: "No echoes found" }]);
  });
});

describe("contentChanged while on", () => {
  it("recomputes the focused entity's highlights", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.emit("editor.contentChanged", { entity: fake.entity });

    // Toggle (3) + the recompute's repetition (1); info and warning were already
    // empty, so they are not re-sent (decision 7).
    await vi.waitFor(() => expect(fake.highlights.length).toBe(4));
    expect(fake.getContentCalls()).toBe(2);
  });

  it("coalesces a burst into exactly one more recompute", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.getContentCalls()).toBe(1);

    // The next recompute hangs on its content read while two more changes arrive.
    const release = fake.gateContent();
    fake.emit("editor.contentChanged", { entity: fake.entity });
    fake.emit("editor.contentChanged", { entity: fake.entity });
    fake.emit("editor.contentChanged", { entity: fake.entity });
    release();

    // Toggle (3) + the in-flight recompute's repetition (1) + one coalesced
    // recompute's repetition (1).
    await vi.waitFor(() => expect(fake.highlights.length).toBe(5));
    expect(fake.getContentCalls()).toBe(3);
  });

  it("ignores a change for another entity", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    // The listener decides synchronously and returns before any content read,
    // so there is nothing left to settle: a recompute would already have asked.
    fake.emit("editor.contentChanged", { entity: { kind: "chapter", id: "c2" } });

    expect(fake.highlights.length).toBe(3);
    expect(fake.getContentCalls()).toBe(1);
  });

  it("recomputes when the language changes while on", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.emit("language.changed", { language: "es" });
    await vi.waitFor(() => expect(fake.getContentCalls()).toBe(2));
  });
});

describe("refresh()", () => {
  it("recomputes the open editor so a kind switch takes effect at once", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.getContentCalls()).toBe(1);

    await controller.refresh();

    // The non-empty kind is repainted; info and warning stay empty, so they are
    // not re-sent.
    expect(fake.getContentCalls()).toBe(2);
    expect(fake.highlights.at(-1)?.kind).toBe("repetition");
  });

  it("does nothing while highlighting is off", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.refresh();

    expect(fake.getContentCalls()).toBe(0);
    expect(fake.highlights).toEqual([]);
  });
});

describe("focusChanged while on", () => {
  it("turns off and clears every kind for a different entity", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.emit("editor.focusChanged", { entity: { kind: "chapter", id: "c2" } });

    await vi.waitFor(() => expect(fake.highlights.length).toBe(6));
    expect(kindsOf(fake.highlights.slice(-3))).toEqual(["repetition", "info", "warning"]);
    expect(fake.highlights.slice(-3).every((call) => call.ranges.length === 0)).toBe(true);

    // Off now: a later change for the old entity recomputes nothing. Decided
    // synchronously in the listener, so there is nothing to wait for.
    fake.emit("editor.contentChanged", { entity: fake.entity });
    expect(fake.highlights.length).toBe(6);
  });

  it("turns off when the focused editor closes, without painting the gone editor", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.highlights.length).toBe(3);

    // The host reports `null` only when the focused editor unmounts: there is no
    // editor left to clear, so nothing more is painted.
    // Synchronous, as above: the null focus only resets state, and paints nothing.
    fake.emit("editor.focusChanged", { entity: null });
    expect(fake.highlights.length).toBe(3);
  });

  it("does not repaint when the same entity reopens, and Next says highlights are off", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    // Close the editor, then reopen the same entity: highlighting starts off,
    // so its content change repaints nothing.
    fake.emit("editor.focusChanged", { entity: null });
    fake.emit("editor.focusChanged", { entity: fake.entity });
    fake.emit("editor.contentChanged", { entity: fake.entity });
    expect(fake.highlights.length).toBe(3);

    await controller.nextEcho();
    expect(fake.reveals).toEqual([]);
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo highlights are off",
    });
  });
});

describe("nextEcho() / previousEcho() while on", () => {
  it("moves to the next and previous echo around the caret", async () => {
    const fake = fakeClient({ text: DOORS, selection: { from: 8, to: 8 } });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 10, to: 14 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 3 of 5: door, repeated 1 word earlier",
    });

    await controller.previousEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 5, to: 9 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 2 of 5: door, repeated 1 word earlier",
    });
  });

  it("wraps forward from the last echo and backward from the first", async () => {
    const fake = fakeClient({ text: DOORS, selection: { from: 20, to: 20 } });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 0, to: 4 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 1 of 5: door, repeated 1 word later",
    });

    fake.setSelection({ from: 0, to: 0 });
    await controller.previousEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 20, to: 24 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 5 of 5: door, repeated 1 word earlier",
    });
  });

  it("visits two Echoes of different kinds that share an offset, in list order", async () => {
    // "door" five times is both a nearby echo and an overused word, so two
    // enabled kinds paint the same offsets: two entries share each `from`.
    const fake = fakeClient({
      text: DOORS,
      editorKinds: ["nearby", "overused"],
      selection: { from: 4, to: 4 },
    });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 5, to: 9 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 3 of 10: door, repeated 1 word earlier",
    });

    // The caret is now on that Echo; the next step must visit the other entry
    // at the same offset, not skip past both.
    fake.setSelection({ from: 5, to: 5 });
    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 5, to: 9 });
    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: "Echo 4 of 10: door, used 5 times",
    });
  });

  it("steps from the stored index when there is no selection to read", async () => {
    const fake = fakeClient({ text: DOORS, selection: null });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 0, to: 4 });

    await controller.nextEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 5, to: 9 });

    await controller.previousEcho();
    expect(fake.reveals.at(-1)).toEqual({ from: 0, to: 4 });
  });

  it("announces no echoes without moving when on but empty", async () => {
    const fake = fakeClient({ text: PLAIN });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    await controller.nextEcho();

    expect(fake.reveals).toEqual([]);
    expect(fake.notifications.at(-1)).toEqual({ variant: "info", message: "No echoes found" });
  });
});

describe("nextEcho() / previousEcho() while off", () => {
  it("announces that highlights are off and never reveals or turns on", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);

    await controller.nextEcho();
    await controller.previousEcho();

    expect(fake.reveals).toEqual([]);
    expect(fake.highlights).toEqual([]);
    expect(fake.notifications).toEqual([
      { variant: "info", message: "Echo highlights are off" },
      { variant: "info", message: "Echo highlights are off" },
    ]);
  });
});

describe("painted window (decision 7)", () => {
  const FULL = ECHO_PAINT_LIMIT + 500;

  it("paints at most ECHO_PAINT_LIMIT ranges", async () => {
    const fake = fakeClient({
      text: repeatedEchoText(FULL),
      selection: { from: 0, to: 0 },
    });
    await createEchoEditor(fake.client).toggleHighlights();

    const repetition = fake.highlights[0];
    expect(repetition.kind).toBe("repetition");
    expect(repetition.ranges).toHaveLength(ECHO_PAINT_LIMIT);
    // The caret is at the start, so the window is clamped to the first entries.
    expect(repetition.ranges[0].from).toBe(0);
  });

  it("centers the painted window on the caret", async () => {
    const fake = fakeClient({ text: repeatedEchoText(FULL), selection: { from: 0, to: 0 } });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.highlights[0].ranges[0].from).toBe(0);

    // Move the caret to the last word and recompute: the window follows, clamped
    // to the end, and still holds the limit.
    fake.setSelection({ from: (FULL - 1) * 5, to: (FULL - 1) * 5 });
    fake.emit("editor.contentChanged", { entity: fake.entity });
    await vi.waitFor(() => expect(fake.highlights.length).toBe(4));

    const repainted = fake.highlights.at(-1);
    expect(repainted?.kind).toBe("repetition");
    expect(repainted?.ranges).toHaveLength(ECHO_PAINT_LIMIT);
    expect(repainted?.ranges.at(-1)?.from).toBe((FULL - 1) * 5);
  });

  it("repaints the window when Next moves past its edge", async () => {
    const fake = fakeClient({ text: repeatedEchoText(FULL), selection: { from: 0, to: 0 } });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    const before = fake.highlights.length;

    // The caret is on the last painted entry (index 1999); Next lands on index
    // 2000, just outside the [0, 2000) window.
    fake.setSelection({ from: 1999 * 5, to: 1999 * 5 });
    await controller.nextEcho();

    expect(fake.reveals.at(-1)).toEqual({ from: 2000 * 5, to: 2000 * 5 + 4 });
    expect(fake.highlights.length).toBeGreaterThan(before);
    const repainted = fake.highlights.at(-1);
    expect(repainted?.kind).toBe("repetition");
    expect(repainted?.ranges.some((range) => range.from === 2000 * 5)).toBe(true);
  });

  it("announces the full count, not the painted window's", async () => {
    const fake = fakeClient({ text: repeatedEchoText(FULL), selection: { from: 0, to: 0 } });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.setSelection({ from: 1999 * 5, to: 1999 * 5 });
    await controller.nextEcho();

    expect(fake.notifications.at(-1)).toEqual({
      variant: "info",
      message: `Echo 2001 of ${FULL}: echo, repeated 1 word earlier`,
    });
  });
});

describe("kind gating and paint dispatch (decision 7)", () => {
  it("detects only the kinds the editor paints", async () => {
    // DOORS is both a nearby chain and an overused word; nearby-only skips
    // overused detection, so info stays empty.
    const nearby = fakeClient({ text: DOORS });
    await createEchoEditor(nearby.client).toggleHighlights();
    expect(nearby.highlights.map((call) => call.kind)).toEqual([
      "repetition",
      "info",
      "warning",
    ]);
    expect(nearby.highlights[0].ranges.length).toBeGreaterThan(0);
    expect(nearby.highlights[1].ranges).toEqual([]);
    expect(nearby.highlights[2].ranges).toEqual([]);

    // Overused-only is the mirror image: no repetition, five info ranges.
    const overused = fakeClient({ text: DOORS, editorKinds: ["overused"] });
    await createEchoEditor(overused.client).toggleHighlights();
    expect(overused.highlights[0].ranges).toEqual([]);
    expect(overused.highlights[1].ranges).toHaveLength(5);
  });

  it("skips sending a kind that was already empty in the previous paint", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.highlights.map((call) => call.kind)).toEqual([
      "repetition",
      "info",
      "warning",
    ]);

    fake.emit("editor.contentChanged", { entity: fake.entity });
    // Only repetition is re-sent; info and warning were already empty.
    await vi.waitFor(() => expect(fake.highlights.length).toBe(4));
    expect(fake.highlights.at(-1)?.kind).toBe("repetition");
  });

  it("dispatches the three kinds before any one resolves", async () => {
    const fake = fakeClient({ text: DOORS, editorKinds: ["nearby", "overused", "phrase"] });
    const gates: Array<() => void> = [];
    fake.client.editor.setHighlights = async ({ kind, ranges }) => {
      fake.highlights.push({ kind, ranges: ranges.map((range) => ({ ...range })) });
      await new Promise<void>((resolve) => gates.push(resolve));
      return { status: "applied" };
    };
    const controller = createEchoEditor(fake.client);

    const done = controller.toggleHighlights();
    // All three were dispatched while the first still awaits its gate.
    await vi.waitFor(() =>
      expect(fake.highlights.map((call) => call.kind)).toEqual(["repetition", "info", "warning"])
    );
    for (const release of gates) release();
    await done;
  });
});

describe("detection language (spec line 15)", () => {
  it("detects a Chapter in its Book's language", async () => {
    // "para" is a Spanish stop word: nothing echoes under es...
    const spanish = fakeClient({ text: PARA, kind: "chapter", bookLanguage: "es" });
    await createEchoEditor(spanish.client).toggleHighlights();
    expect(spanish.highlights[0].ranges).toEqual([]);
    expect(spanish.notifications).toEqual([{ variant: "info", message: "No echoes found" }]);

    // ...while the same text echoes in English, so the Book's language decided it.
    const english = fakeClient({ text: PARA, kind: "chapter", bookLanguage: "en" });
    await createEchoEditor(english.client).toggleHighlights();
    expect(english.highlights[0].ranges.length).toBeGreaterThan(0);
  });

  it("detects a Note in its own language before its Book's", async () => {
    // The Note's own es wins over its Book's en: "para" is silent.
    const note = fakeClient({ text: PARA, kind: "note", noteLanguage: "es", bookLanguage: "en" });
    await createEchoEditor(note.client).toggleHighlights();
    expect(note.highlights[0].ranges).toEqual([]);
    expect(note.notifications).toEqual([{ variant: "info", message: "No echoes found" }]);
  });

  it("falls back to a Note's Book language when the Note has none", async () => {
    const note = fakeClient({ text: PARA, kind: "note", noteLanguage: null, bookLanguage: "es" });
    await createEchoEditor(note.client).toggleHighlights();
    expect(note.highlights[0].ranges).toEqual([]);

    const englishBook = fakeClient({ text: PARA, kind: "note", noteLanguage: null, bookLanguage: "en" });
    await createEchoEditor(englishBook.client).toggleHighlights();
    expect(englishBook.highlights[0].ranges.length).toBeGreaterThan(0);
  });
});

describe("runtime Command routing", () => {
  it("routes the three editor Command ids to the controller", async () => {
    const fake = fakeClient({ text: DOORS, selection: { from: 8, to: 8 } });
    const host: { run: ((params: unknown) => unknown) | null } = { run: null };
    const serve: EchoServe = (_client, options) => {
      const handler = options.onHostRequest;
      if (handler !== undefined) host.run = (params) => handler(PLUGIN_COMMAND_RUN_REQUEST, params);
    };
    startEchoes(fake.client as unknown as PluginClient, serve);
    const run = host.run;
    if (run === null) throw new Error("the runtime registered no host request handler");

    await run({ id: TOGGLE_HIGHLIGHTS });
    expect(kindsOf(fake.highlights)).toEqual(["repetition", "info", "warning"]);

    await run({ id: NEXT_ECHO });
    expect(fake.reveals.at(-1)).toEqual({ from: 10, to: 14 });

    await run({ id: PREVIOUS_ECHO });
    expect(fake.reveals.at(-1)).toEqual({ from: 5, to: 9 });
  });
});
