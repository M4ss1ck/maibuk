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
import {
  ECHOES_COLOR_KEY,
  ECHOES_EDITOR_KEY,
  ECHOES_HIGHLIGHTS_KEY,
  ECHOES_PALETTE_KEY,
} from "./settings";
import { echoColor } from "./colors";

/** One recorded `editor.setHighlights` call. */
interface HighlightCall {
  kind: string;
  ranges: Array<{ from: number; to: number; label?: string; color?: string }>;
}

/** One recorded `notifications.show` call. */
interface NotificationCall {
  variant: string;
  message: string;
}

type Listener = (payload: unknown) => void | Promise<void>;

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
  /** The kind of editor: a Chapter, a Note, or the Ephemeral. */
  kind?: "chapter" | "note" | "ephemeral";
  /** The caret the editor reports, or null for a no-target selection. */
  selection?: { from: number; to: number } | null;
  /** The language the host reports with the editor's content (default en). */
  language?: string;
  /** The editor highlight kinds to store (unset leaves the nearby-only default). */
  editorKinds?: readonly string[];
  /** The "Color highlights by echo" value to store (unset leaves it off, as 0.1.0 did). */
  colorByEcho?: boolean;
  /** The Echo color Palette to store (unset leaves Okabe-Ito, as 0.2.0 did) (#533). */
  palette?: string;
  /** The raw "Toggle echo highlights" value to store (unset leaves it missing). */
  highlightsOn?: unknown;
  /** Makes every storage write reject, as a refusing host would. */
  refuseWrites?: boolean;
}

type FakeEntity = { kind: "chapter" | "note" | "ephemeral"; id: string };

function fakeClient(options: FakeOptions = {}) {
  const kind = options.kind ?? "chapter";
  let entity: FakeEntity = {
    kind,
    id: options.id ?? (kind === "chapter" ? "c1" : kind === "note" ? "n1" : "ephemeral"),
  };
  const text = options.text ?? DOOR;
  let language = options.language ?? "en";
  const storage = new Map<string, unknown>();
  if (options.editorKinds !== undefined) storage.set(ECHOES_EDITOR_KEY, [...options.editorKinds]);
  if (options.colorByEcho !== undefined) storage.set(ECHOES_COLOR_KEY, options.colorByEcho);
  if (options.palette !== undefined) storage.set(ECHOES_PALETTE_KEY, options.palette);
  if (options.highlightsOn !== undefined) storage.set(ECHOES_HIGHLIGHTS_KEY, options.highlightsOn);
  const listeners = new Map<string, Set<Listener>>();
  const highlights: HighlightCall[] = [];
  const reveals: Array<{ from: number; to: number }> = [];
  const notifications: NotificationCall[] = [];
  const pressed: boolean[] = [];

  let selection = options.selection === undefined ? { from: 0, to: 0 } : options.selection;
  let getContentCalls = 0;
  let gate: Promise<void> | null = null;
  let highlightsReadGate: Promise<void> | null = null;
  // Whether an editor is focused. Off models the editor having unmounted, which
  // is what the host reports as `editor.focusChanged` with a null entity.
  let focused = true;

  const client: EchoEditorClient = {
    editor: {
      async getContent() {
        getContentCalls++;
        const hasFocus = focused;
        if (gate !== null) await gate;
        if (!hasFocus) return { status: "no-target" };
        return { status: "ok", entity, language, content: { text, html: `<p>${text}</p>` } };
      },
      async getSelection() {
        if (!focused) return { status: "no-target" };
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
        if (key === ECHOES_HIGHLIGHTS_KEY && highlightsReadGate !== null) await highlightsReadGate;
        return storage.get(key) ?? null;
      },
      async set({ key, value }) {
        if (options.refuseWrites) throw new Error("storage refused the write");
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
    /** The entity the focused editor is bound to now. */
    get entity(): FakeEntity {
      return entity;
    },
    highlights,
    reveals,
    notifications,
    /** Every `toolbar.setPressed` value the controller sent, in order. */
    pressed,
    getContentCalls: () => getContentCalls,
    /** The old Worker is gone: its event subscriptions die with it. */
    dropListeners() {
      listeners.clear();
    },
    setFocused(next: boolean) {
      focused = next;
    },
    setSelection(next: { from: number; to: number } | null) {
      selection = next;
    },
    /** The author switches the editor's language (its Spell Check language). */
    setLanguage(next: string) {
      language = next;
    },
    /** Moves focus to another entity (a Chapter, a Note, or the Ephemeral). */
    setEntity(next: FakeEntity) {
      entity = next;
    },
    /** Makes the startup read of the stored highlights switch wait for the returned release. */
    gateHighlightsRead(): () => void {
      let release!: () => void;
      highlightsReadGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        highlightsReadGate = null;
        release();
      };
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
    /** Resolves when every handler the event reached has finished its work. */
    emit(event: PluginApiEventId, payload: unknown): Promise<void> {
      return Promise.all(
        [...(listeners.get(event) ?? [])].map((listener) => listener(payload))
      ).then(() => undefined);
    },
    /** The Plugin's own storage, so a test can change a stored setting between recomputes. */
    storage,
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

/** Whether a repetition paint with ranges was sent at or after call index `mark`. */
const paintedSince = (fake: { highlights: readonly HighlightCall[] }, mark: number): boolean =>
  fake.highlights.slice(mark).some((call) => call.kind === "repetition" && call.ranges.length > 0);

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

describe("color highlights by echo (#532)", () => {
  // "door" is one nearby echo: both of its words share the Echo's color.
  const DOOR_COLOR = "#a929ff";
  const lastRepetition = (calls: readonly HighlightCall[]) =>
    calls.filter((call) => call.kind === "repetition").at(-1);

  it("paints no color by default, as 0.1.0 did", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();

    const [repetition] = fake.highlights;
    expect(repetition.ranges.length).toBeGreaterThan(0);
    for (const range of repetition.ranges) expect(range).not.toHaveProperty("color");
  });

  it("paints every occurrence of one Echo in the same Echo color when on", async () => {
    const fake = fakeClient({ colorByEcho: true });
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();

    const ranges = fake.highlights[0].ranges;
    expect(ranges.length).toBe(2);
    expect(ranges.map((range) => range.color)).toEqual([DOOR_COLOR, DOOR_COLOR]);
  });

  it("keeps the same color after a recompute of the same text", async () => {
    const fake = fakeClient({ colorByEcho: true });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    await controller.refresh();
    await controller.refresh();

    const colors = fake.highlights
      .filter((call) => call.kind === "repetition")
      .flatMap((call) => call.ranges.map((range) => range.color));
    expect(colors.length).toBeGreaterThan(2);
    expect(new Set(colors)).toEqual(new Set([DOOR_COLOR]));
  });

  it("repaints an open editor at once when the switch flips on", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(lastRepetition(fake.highlights)?.ranges[0]).not.toHaveProperty("color");

    fake.storage.set(ECHOES_COLOR_KEY, true);
    await controller.refresh();

    expect(lastRepetition(fake.highlights)?.ranges.map((range) => range.color)).toEqual([
      DOOR_COLOR,
      DOOR_COLOR,
    ]);
  });

  it("paints each Echo in the stored Palette (#533)", async () => {
    const fake = fakeClient({ colorByEcho: true, palette: "soft" });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    expect(lastRepetition(fake.highlights)?.ranges.map((range) => range.color)).toEqual([
      echoColor("door", "soft"),
      echoColor("door", "soft"),
    ]);
  });

  it("repaints an open editor in the new Palette at once (#533)", async () => {
    const fake = fakeClient({ colorByEcho: true });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.storage.set(ECHOES_PALETTE_KEY, "vivid");
    await controller.refresh();

    expect(lastRepetition(fake.highlights)?.ranges.map((range) => range.color)).toEqual([
      echoColor("door", "vivid"),
      echoColor("door", "vivid"),
    ]);
  });

  it("paints Okabe-Ito when the stored Palette is unknown (#533)", async () => {
    const fake = fakeClient({ colorByEcho: true, palette: "neon" });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    expect(lastRepetition(fake.highlights)?.ranges.map((range) => range.color)).toEqual([
      DOOR_COLOR,
      DOOR_COLOR,
    ]);
  });

  it("repaints an open editor without colors at once when the switch flips off", async () => {
    const fake = fakeClient({ colorByEcho: true });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.storage.set(ECHOES_COLOR_KEY, false);
    await controller.refresh();

    for (const range of lastRepetition(fake.highlights)?.ranges ?? [])
      expect(range).not.toHaveProperty("color");
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
  it("keeps highlights on when a cold-start toggle is followed by a null focus while the editor is still focused", async () => {
    // Echoes starts on demand, so the first toggle runs on a fresh controller.
    // A stale null focus that arrives after the toggle set highlights on must
    // not reset them: the editor is still focused, so nothing has closed.
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.pressed).toEqual([true]);
    expect(fake.highlights.length).toBe(3);

    fake.emit("editor.focusChanged", { entity: null });
    await vi.waitFor(() => expect(fake.pressed).toEqual([true]));
    expect(fake.pressed.at(-1)).toBe(true);
    expect(fake.highlights.length).toBe(3);

    await controller.nextEcho();
    expect(fake.reveals.length).toBe(1);
  });

  it("keeps the switch on and clears the old editor for a different entity", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.setEntity({ kind: "chapter", id: "c2" });
    await fake.emit("editor.focusChanged", { entity: fake.entity });

    expect(fake.pressed).toEqual([true]);
    // The old editor's three kinds are cleared, then the new one is painted.
    expect(kindsOf(fake.highlights.slice(3, 6))).toEqual(["repetition", "info", "warning"]);
    expect(fake.highlights.slice(3, 6).every((call) => call.ranges.length === 0)).toBe(true);
    expect(paintedSince(fake, 6)).toBe(true);

    // Still on: a change to the new entity recomputes it.
    const mark = fake.highlights.length;
    await fake.emit("editor.contentChanged", { entity: fake.entity });
    expect(paintedSince(fake, mark)).toBe(true);
  });

  it("keeps the switch on when the focused editor closes, without painting the gone editor", async () => {
    const fake = fakeClient();
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    expect(fake.highlights.length).toBe(3);

    // The host reports `null` only when the focused editor unmounts: there is no
    // editor left to clear, so nothing is painted, and the switch stays pressed.
    fake.setFocused(false);
    await fake.emit("editor.focusChanged", { entity: null });
    expect(fake.highlights.length).toBe(3);
    expect(fake.pressed).toEqual([true]);
  });

  it("repaints the same entity when it reopens, with the switch still on", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    // Close the editor; the null focus is confirmed before the reopen arrives.
    fake.setFocused(false);
    await fake.emit("editor.focusChanged", { entity: null });
    expect(fake.pressed).toEqual([true]);

    fake.setFocused(true);
    await Promise.all([
      fake.emit("editor.focusChanged", { entity: fake.entity }),
      fake.emit("editor.contentChanged", { entity: fake.entity }),
    ]);
    expect(paintedSince(fake, 3)).toBe(true);

    await controller.nextEcho();
    expect(fake.reveals.length).toBe(1);
  });
});

describe("one highlights switch for every editor", () => {
  it("keeps the switch pressed and paints a Note after focus moves off a Chapter", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    const mark = fake.highlights.length;
    fake.setEntity({ kind: "note", id: "n1" });
    await fake.emit("editor.focusChanged", { entity: fake.entity });

    expect(fake.pressed).toEqual([true]);
    expect(paintedSince(fake, mark)).toBe(true);
  });

  it("clears the old editor's paint before painting the new one", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    const mark = fake.highlights.length;
    fake.setEntity({ kind: "note", id: "n1" });
    await fake.emit("editor.focusChanged", { entity: fake.entity });

    const sent = fake.highlights.slice(mark);
    expect(kindsOf(sent.slice(0, 3))).toEqual(["repetition", "info", "warning"]);
    expect(sent.slice(0, 3).every((call) => call.ranges.length === 0)).toBe(true);
    expect(paintedSince(fake, mark + 3)).toBe(true);
  });

  it("keeps the switch on across Chapter, Note, and back to the Chapter", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();

    fake.setEntity({ kind: "note", id: "n1" });
    await fake.emit("editor.focusChanged", { entity: fake.entity });

    const mark = fake.highlights.length;
    fake.setEntity({ kind: "chapter", id: "c1" });
    await fake.emit("editor.focusChanged", { entity: fake.entity });

    expect(fake.pressed).toEqual([true]);
    expect(paintedSince(fake, mark)).toBe(true);
    expect(fake.notifications).toEqual([]);
  });

  it("presses the switch and paints the focused editor at startup when stored on", async () => {
    const fake = fakeClient({ text: DOORS, highlightsOn: true });
    createEchoEditor(fake.client);

    await vi.waitFor(() => expect(fake.pressed).toEqual([true]));
    await vi.waitFor(() => expect(paintedSince(fake, 0)).toBe(true));
    expect(fake.getContentCalls()).toBe(1);
    expect(fake.notifications).toEqual([]);
  });

  it("announces no echoes at startup, even when the enabled kinds find none", async () => {
    const fake = fakeClient({ text: PLAIN, highlightsOn: true });
    await createEchoEditor(fake.client).ready;

    expect(fake.pressed).toEqual([true]);
    expect(fake.getContentCalls()).toBe(1);
    expect(fake.notifications).toEqual([]);
  });

  it("waits for the next editor focus when none is focused at startup", async () => {
    const fake = fakeClient({ text: DOORS, highlightsOn: true });
    fake.setFocused(false);
    await createEchoEditor(fake.client).ready;

    expect(fake.pressed).toEqual([true]);
    expect(fake.highlights).toEqual([]);

    fake.setFocused(true);
    await fake.emit("editor.focusChanged", { entity: fake.entity });
    expect(paintedSince(fake, 0)).toBe(true);
    expect(fake.pressed).toEqual([true]);
  });

  it.each([
    ["missing", undefined],
    ["false", false],
    ["a non-boolean string", "true"],
  ])("stays off at startup when the stored switch is %s", async (_label, value) => {
    const fake = fakeClient({ text: DOORS, highlightsOn: value });
    await createEchoEditor(fake.client).ready;

    expect(fake.pressed).toEqual([]);
    expect(fake.getContentCalls()).toBe(0);
    expect(fake.highlights).toEqual([]);
  });

  it("lets an explicit toggle win over a startup read that resolves later", async () => {
    const fake = fakeClient({ text: DOORS, highlightsOn: true });
    const release = fake.gateHighlightsRead();
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();
    await controller.toggleHighlights();
    release();
    await controller.ready;

    expect(fake.pressed).toEqual([true, false]);
    expect(fake.storage.get(ECHOES_HIGHLIGHTS_KEY)).toBe(false);
    expect(fake.highlights.slice(-3).every((call) => call.ranges.length === 0)).toBe(true);
  });

  it("writes highlights true when toggled on", async () => {
    const fake = fakeClient({ text: DOORS });
    await createEchoEditor(fake.client).toggleHighlights();

    expect(fake.storage.get(ECHOES_HIGHLIGHTS_KEY)).toBe(true);
  });

  it("writes highlights false when toggled off", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    await controller.toggleHighlights();

    expect(fake.storage.get(ECHOES_HIGHLIGHTS_KEY)).toBe(false);
  });

  it("still toggles on and off in memory when storage refuses the write, silently", async () => {
    const fake = fakeClient({ text: DOORS, refuseWrites: true });
    const controller = createEchoEditor(fake.client);

    await controller.toggleHighlights();
    expect(fake.pressed).toEqual([true]);
    expect(paintedSince(fake, 0)).toBe(true);
    expect(fake.notifications).toEqual([]);

    await controller.toggleHighlights();
    expect(fake.pressed).toEqual([true, false]);
    expect(fake.highlights.slice(-3).every((call) => call.ranges.length === 0)).toBe(true);
    expect(fake.notifications).toEqual([]);
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
    expect(nearby.highlights.map((call) => call.kind)).toEqual(["repetition", "info", "warning"]);
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
    expect(fake.highlights.map((call) => call.kind)).toEqual(["repetition", "info", "warning"]);

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
  it("detects in the language the host reports for the editor", async () => {
    // "para" is a Spanish stop word: nothing echoes under es...
    const spanish = fakeClient({ text: PARA, kind: "chapter", language: "es" });
    await createEchoEditor(spanish.client).toggleHighlights();
    expect(spanish.highlights[0].ranges).toEqual([]);
    expect(spanish.notifications).toEqual([{ variant: "info", message: "No echoes found" }]);

    // ...while the same text echoes in English, so the reported language decided it.
    const english = fakeClient({ text: PARA, kind: "note", language: "en" });
    await createEchoEditor(english.client).toggleHighlights();
    expect(english.highlights[0].ranges.length).toBeGreaterThan(0);
  });

  it("detects in the Ephemeral, in its Spell Check language", async () => {
    const ephemeral = fakeClient({ text: PARA, kind: "ephemeral", language: "en" });
    await createEchoEditor(ephemeral.client).toggleHighlights();
    expect(ephemeral.highlights[0].ranges.length).toBeGreaterThan(0);

    const spanish = fakeClient({ text: PARA, kind: "ephemeral", language: "es" });
    await createEchoEditor(spanish.client).toggleHighlights();
    expect(spanish.highlights[0].ranges).toEqual([]);
  });

  it("follows a language switch while on, without a toggle", async () => {
    const fake = fakeClient({ text: PARA, kind: "note", language: "en" });
    await createEchoEditor(fake.client).toggleHighlights();
    expect(fake.highlights[0].ranges.length).toBeGreaterThan(0);

    // The host reports a language switch as a content change.
    fake.setLanguage("es");
    await fake.emit("editor.contentChanged", { entity: fake.entity });

    const repetition = fake.highlights.filter((call) => call.kind === "repetition").at(-1);
    expect(repetition?.ranges).toEqual([]);
  });

  it("falls back to the app's language when the host reports a blank one", async () => {
    const fake = fakeClient({ text: PARA, kind: "note", language: " " });
    await createEchoEditor(fake.client).toggleHighlights();
    // The fake's UI language is en, where "para" echoes.
    expect(fake.highlights[0].ranges.length).toBeGreaterThan(0);
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

/**
 * The #529 transition audit. Each test drives one transition of the highlight
 * controller and asserts the two invariants the issue names: the painted state
 * matches the Toggle Button's pressed state, and nothing paints for an entity
 * that is no longer focused.
 */
describe("highlight transition audit (#529)", () => {
  it("a null focus whose confirmation is in flight does not wipe a newer focus on the same entity", async () => {
    // The null focus reads the editor while it is gone; before its answer lands,
    // the same entity is focused again. The late answer must not reset a state
    // whose focus moved since the null arrived.
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    const release = fake.gateContent();
    fake.setFocused(false);
    const nullFocus = fake.emit("editor.focusChanged", { entity: null });
    fake.setFocused(true);
    const sameFocus = fake.emit("editor.focusChanged", { entity: fake.entity });
    release();
    await Promise.all([nullFocus, sameFocus]);
    expect(lastPressed(fake)).toBe(true);
    expect(fake.highlights.length).toBe(3);
  });

  it("focusChanged for the same entity during a toggle's content read still turns highlights on", async () => {
    // The host can announce the focused entity while the toggle reads it (Echoes
    // starting on demand). That is not a move: the toggle must still turn on.
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    const release = fake.gateContent();
    const toggling = controller.toggleHighlights();
    fake.emit("editor.focusChanged", { entity: fake.entity });
    release();
    await toggling;
    expect(lastPressed(fake)).toBe(true);
    expect(fake.highlights.length).toBe(3);
  });

  /** The last `setPressed` value and whether the last paint left any range. */
  const lastPressed = (fake: { pressed: boolean[] }) => fake.pressed.at(-1);
  const paintedAnything = (fake: { highlights: HighlightCall[] }) =>
    fake.highlights.slice(-3).some((call) => call.ranges.length > 0);

  it("focus change during a toggle: the toggle does not paint an editor that lost focus", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    const release = fake.gateContent();
    const toggling = controller.toggleHighlights();
    // Focus moves to another editor while the toggle still reads the old one.
    fake.emit("editor.focusChanged", { entity: { kind: "chapter", id: "c2" } });
    release();
    await toggling;
    // The aborted toggle never pressed the button, so nothing was sent for it.
    expect(lastPressed(fake) ?? false).toBe(false);
    expect(paintedAnything(fake)).toBe(false);
  });

  it("chapter switch during a recompute: the in-flight recompute paints nothing for the old chapter", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    const before = fake.highlights.length;
    const oldChapter = fake.entity;
    const release = fake.gateContent();
    const recomputing = fake.emit("editor.contentChanged", { entity: oldChapter });
    // Focus moves to Chapter c2 while the recompute still reads c1.
    fake.setEntity({ kind: "chapter", id: "c2" });
    const moved = fake.emit("editor.focusChanged", { entity: fake.entity });
    release();
    await Promise.all([recomputing, moved]);
    // The switch clears c1 (three empty sends), then paints c2 once. The
    // in-flight c1 recompute sends nothing, so c2 is the only nonempty repaint.
    expect(
      fake.highlights.slice(before, before + 3).every((call) => call.ranges.length === 0)
    ).toBe(true);
    expect(
      fake.highlights
        .slice(before)
        .filter((call) => call.kind === "repetition" && call.ranges.length > 0)
    ).toHaveLength(1);
    expect(lastPressed(fake)).toBe(true);
  });

  it("editor unmount during a recompute: nothing is painted after the editor closes", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    const before = fake.highlights.length;
    const release = fake.gateContent();
    const recomputing = fake.emit("editor.contentChanged", { entity: fake.entity });
    fake.setFocused(false);
    const unmounted = fake.emit("editor.focusChanged", { entity: null });
    release();
    await Promise.all([recomputing, unmounted]);
    // Nothing is painted once the editor is gone; the switch itself stays on.
    expect(fake.highlights.length).toBe(before);
    expect(lastPressed(fake)).toBe(true);
  });

  it("Plugin restart while on: a new activation starts off and paints nothing", async () => {
    // The host drops this Plugin's highlights and pressed state when it stops
    // (lifecycle.ts clearPluginHighlights, clearToolbarPressed). A new activation
    // is a fresh controller: it must start off, so no event repaints anything.
    const fake = fakeClient({ text: DOORS });
    const first = createEchoEditor(fake.client);
    await first.toggleHighlights();
    expect(paintedAnything(fake)).toBe(true);
    const before = fake.highlights.length;

    fake.dropListeners();
    const second = createEchoEditor(fake.client);
    await Promise.all([
      fake.emit("editor.contentChanged", { entity: fake.entity }),
      second.refresh(),
    ]);
    expect(fake.highlights.length).toBe(before);
  });

  it("toggle during a recompute: a toggle off wins over the in-flight recompute", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await controller.toggleHighlights();
    const release = fake.gateContent();
    const recomputing = fake.emit("editor.contentChanged", { entity: fake.entity });
    const toggling = controller.toggleHighlights();
    release();
    await Promise.all([recomputing, toggling]);
    expect(lastPressed(fake)).toBe(false);
    expect(paintedAnything(fake)).toBe(false);
  });

  it("button and shortcut fired together: the final pressed state matches what is painted", async () => {
    const fake = fakeClient({ text: DOORS });
    const controller = createEchoEditor(fake.client);
    await Promise.all([controller.toggleHighlights(), controller.toggleHighlights()]);
    expect(lastPressed(fake) ?? false).toBe(paintedAnything(fake));
  });
});
