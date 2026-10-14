/**
 * The Plugins bench driver's measurement primitives (issue #448, unit 4b).
 *
 * These are the browser-side halves of the measurements `e2e/plugins-bench/
 * plugins.bench.ts` takes through Playwright: reading the User Timing mark or
 * measure, dispatching a Shortcut or a typed key without Playwright (the
 * `webkitgtk` lane runs inside the app, on the real WebKitGTK binary), and
 * matching each keystroke to the echo it produced. They are pure or DOM-only,
 * so they run under jsdom with fake timers.
 *
 * The launch and startToReady marks are the ones `benchMarksEnabled()` guards
 * (`src/pages/Home.tsx`, `src/features/plugins/lifecycle.ts`).
 */

/** The Home gallery's first-render mark, one per page load. */
export const GALLERY_MARK = "app.gallery.first-render";

/** The `plugin.start:<id>` measure's duration name for one Plugin id. */
export function pluginStartMeasure(pluginId: string): string {
  return `plugin.start:${pluginId}`;
}

/** The `startTime` of the first User Timing entry `name`, or null when absent. */
export function readMarkStart(name: string): number | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByName !== "function") {
    return null;
  }
  const entries = performance.getEntriesByName(name);
  return entries.length > 0 ? entries[0].startTime : null;
}

/** The `duration` of the first User Timing measure `name`, or null when absent. */
export function readMeasureDuration(name: string): number | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByName !== "function") {
    return null;
  }
  const entries = performance.getEntriesByName(name, "measure");
  return entries.length > 0 ? entries[0].duration : null;
}

export interface PollOptions {
  timeoutMs: number;
  intervalMs?: number;
  /** Overridable for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls `read` until it returns a non-null value, or `timeoutMs` elapses; a
 * timeout throws, so a lane never reads a measurement that never arrived.
 */
export async function pollFor<T>(
  read: () => T | null,
  { timeoutMs, intervalMs = 50, now = () => Date.now(), sleep = defaultSleep }: PollOptions
): Promise<T> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== null) return value;
    if (now() >= deadline) throw new Error("timed out waiting for a measurement");
    await sleep(intervalMs);
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A Shortcut chord as a `KeyboardEvent` init the host recognises. */
export interface ChordEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const LETTER_CODE: Record<string, string> = {
  a: "KeyA", b: "KeyB", c: "KeyC", d: "KeyD", e: "KeyE", f: "KeyF", g: "KeyG",
  h: "KeyH", i: "KeyI", j: "KeyJ", k: "KeyK", l: "KeyL", m: "KeyM", n: "KeyN",
  o: "KeyO", p: "KeyP", q: "KeyQ", r: "KeyR", s: "KeyS", t: "KeyT", u: "KeyU",
  v: "KeyV", w: "KeyW", x: "KeyX", y: "KeyY", z: "KeyZ",
};

/**
 * Turns a Shortcut chord (`"Mod+Alt+e"`, as a manifest declares it) into the
 * `KeyboardEvent` init the host's Shortcut handling reads (`shortcut-keys.ts`
 * `stepsFromEvent`). On the `webkitgtk` lane the host's Mod key is Ctrl, so
 * `Mod` maps to `ctrlKey`; `Ctrl`/`Control` also map to `ctrlKey`, `Meta`/`Cmd`
 * to `metaKey`, `Alt`/`Option` to `altKey`, `Shift` to `shiftKey`. Pure.
 */
export function parseChord(chord: string): ChordEvent {
  const parts = chord.split("+").filter((part) => part !== "");
  const keyToken = parts.pop() ?? "";
  const event: ChordEvent = {
    key: keyToken,
    code: LETTER_CODE[keyToken.toLowerCase()] ?? "",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  };
  for (const token of parts) {
    switch (token.toLowerCase()) {
      case "mod":
      case "ctrl":
      case "control":
        event.ctrlKey = true;
        break;
      case "meta":
      case "cmd":
      case "command":
        event.metaKey = true;
        break;
      case "alt":
      case "option":
        event.altKey = true;
        break;
      case "shift":
        event.shiftKey = true;
        break;
      default:
        break;
    }
  }
  return event;
}

/**
 * Dispatches the chord's `keydown` on `target` (bubbling, so the host's window
 * listener at the capture or bubble phase sees it), exactly as Playwright's
 * `keyboard.press` would.
 */
export function dispatchShortcut(target: EventTarget, chord: ChordEvent): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: chord.key,
      code: chord.code,
      ctrlKey: chord.ctrlKey,
      altKey: chord.altKey,
      metaKey: chord.metaKey,
      shiftKey: chord.shiftKey,
      bubbles: true,
      cancelable: true,
    })
  );
}

/**
 * Sets an input's value through the native prototype setter, so React's value
 * tracker sees the change a real keystroke would have produced instead of
 * dropping it as a no-op write.
 */
export function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
}

/**
 * One synthetic keystroke into a host-owned field: `keydown`, the value set
 * through the native setter, an `input` event (which is what React's
 * `onChange`/`onInput` and the Remote UI host both listen for), then `keyup`.
 * `nextValue` is the field's value after this key.
 */
export function dispatchTypingKey(input: HTMLInputElement, key: string, nextValue: string): void {
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key, code: LETTER_CODE[key.toLowerCase()] ?? "", bubbles: true })
  );
  setNativeInputValue(input, nextValue);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: key }));
  input.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

/** The echo Text element the bench fixture renders (its text starts `echo:`). */
export function findEchoElement(root: ParentNode): Element | null {
  for (const element of root.querySelectorAll("p, div, span")) {
    if (element.textContent?.startsWith("echo:")) return element;
  }
  return null;
}

/** An element's accessible name from `aria-label` or `aria-labelledby`. */
function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label !== null && label !== "") return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text !== "") return text;
  }
  return element.textContent?.trim() ?? "";
}

/** The echo page's host-owned input (labelled `Echo input`). */
export function findEchoInput(root: ParentNode): HTMLInputElement | null {
  for (const input of root.querySelectorAll("input")) {
    if (accessibleName(input) === "Echo input") return input;
  }
  // React Aria associates its label by id; a plain `aria-label` also matches.
  return root.querySelector<HTMLInputElement>('input[aria-label="Echo input"]');
}

/** One echo mutation: the echo Text's value and the time it committed. */
export interface EchoMutation {
  t: number;
  text: string;
}

/**
 * Pairs each keystroke's start time with the first echo that contains its
 * prefix, the same rule `plugins.bench.ts` `measureEcho` uses: a later echo of
 * a longer prefix still contains this key's prefix, so a burst the Worker
 * coalesces into one update still yields one sample per key. Pure.
 */
export function matchEchoSamples(
  keyTimes: readonly number[],
  mutations: readonly EchoMutation[],
  text: string
): number[] {
  const samples: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const expected = `echo:${text.slice(0, i + 1)}`;
    const mutation = mutations.find((entry) => entry.text.includes(expected));
    if (mutation !== undefined && keyTimes[i] !== undefined) {
      samples.push(mutation.t - keyTimes[i]);
    }
  }
  return samples;
}
