import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createFieldTarget, installDictationFieldTracker } from "@/features/dictation/field-target";
import { FIELD_BEFORE_LIMIT } from "@/features/dictation/plain-text";
import { attachSession, resetDictationHubForTests } from "@/features/dictation/hub";
import type { DictationTarget } from "@/features/dictation/session";
import { useSettingsStore } from "@/features/settings/store";

function makeInput(type?: string): HTMLInputElement {
  const el = document.createElement("input");
  if (type !== undefined) el.setAttribute("type", type);
  document.body.appendChild(el);
  return el;
}

function makeTextarea(): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  document.body.appendChild(el);
  return el;
}

// document.execCommand stubbed the way a browser implements it: insertText and
// delete edit the focused field, undo/redo walk a small value stack.
function stubExecCommand() {
  const undoStacks = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string[]>();
  const redoStacks = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string[]>();
  const push = (
    map: WeakMap<HTMLInputElement | HTMLTextAreaElement, string[]>,
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string
  ) => {
    const stack = map.get(el) ?? [];
    stack.push(value);
    map.set(el, stack);
  };
  const fn = vi.fn((command: string, _showUI?: boolean, value?: string): boolean => {
    const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return false;
    if (command === "insertText") {
      push(undoStacks, el, el.value);
      redoStacks.set(el, []);
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      el.setRangeText(value ?? "", start, end, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }
    if (command === "delete") {
      push(undoStacks, el, el.value);
      redoStacks.set(el, []);
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      if (start === end) el.setRangeText("", Math.max(0, start - 1), end, "end");
      else el.setRangeText("", start, end, "end");
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return true;
    }
    if (command === "undo") {
      const stack = undoStacks.get(el) ?? [];
      const prev = stack.pop();
      if (prev === undefined) return false;
      push(redoStacks, el, el.value);
      el.value = prev;
      return true;
    }
    if (command === "redo") {
      const stack = redoStacks.get(el) ?? [];
      const next = stack.pop();
      if (next === undefined) return false;
      push(undoStacks, el, el.value);
      el.value = next;
      return true;
    }
    return false;
  });
  (document as unknown as { execCommand: typeof fn }).execCommand = fn;
  return fn;
}

// Whether the fallback path set the value through the native setter (what
// lets React's controlled inputs notice), rather than the execCommand path.
function spyNativeValueSetter() {
  const proto = HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value")!;
  const calls: string[] = [];
  const original = descriptor.set!;
  Object.defineProperty(proto, "value", {
    ...descriptor,
    set(this: HTMLInputElement, v: string) {
      calls.push(v);
      original.call(this, v);
    },
  });
  return {
    calls,
    restore() {
      Object.defineProperty(proto, "value", descriptor);
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  resetDictationHubForTests();
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("createFieldTarget", () => {
  it("inserts dictated text as exactly one input event (the fallback path: jsdom has no execCommand)", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    await user.click(el);
    const target = createFieldTarget(el, "text");
    const events: InputEvent[] = [];
    el.addEventListener("input", (event) => events.push(event as InputEvent));
    target.apply([{ kind: "text", text: "My book" }]);
    expect(el.value).toBe("My book");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("My book");
  });

  it("updates a React-controlled input's state", async () => {
    const user = userEvent.setup();
    function Controlled() {
      const [value, setValue] = useState("");
      return (
        <>
          <input
            aria-label="title"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <output data-testid="echo">{value}</output>
        </>
      );
    }
    const { getByLabelText, getByTestId } = render(<Controlled />);
    const el = getByLabelText("title") as HTMLInputElement;
    await user.click(el);
    const target = createFieldTarget(el, "text");
    act(() => {
      target.apply([{ kind: "text", text: "My book" }]);
    });
    expect(el.value).toBe("My book");
    expect(getByTestId("echo").textContent).toBe("My book");
  });

  it("uses one native execCommand per line after selecting the replaced range", async () => {
    const user = userEvent.setup();
    const exec = stubExecCommand();
    const setter = spyNativeValueSetter();
    try {
      const el = makeInput();
      await user.click(el);
      const target = createFieldTarget(el, "text");
      const setSelection = vi.spyOn(el, "setSelectionRange");
      target.apply([
        { kind: "text", text: "Hello" },
        { kind: "text", text: "world" },
      ]);
      expect(el.value).toBe("Hello world");
      expect(exec).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledWith("insertText", false, "Hello world");
      // The replaced range is selected first, then the command runs.
      expect(setSelection.mock.calls[0]).toEqual([0, 0]);
      expect(exec.mock.invocationCallOrder[0]).toBeGreaterThan(
        setSelection.mock.invocationCallOrder[0]
      );
      // The native path ran: the fallback setter never did.
      expect(setter.calls).toEqual([]);
      target.apply([{ kind: "text", text: "again" }]);
      expect(exec).toHaveBeenCalledTimes(2);
    } finally {
      setter.restore();
    }
  });

  it("falls back to the setter path when execCommand refuses", async () => {
    const user = userEvent.setup();
    const exec = stubExecCommand();
    exec.mockImplementationOnce(() => false);
    const setter = spyNativeValueSetter();
    try {
      const el = makeInput();
      await user.click(el);
      const target = createFieldTarget(el, "text");
      target.apply([{ kind: "text", text: "Hi" }]);
      expect(el.value).toBe("Hi");
      expect(setter.calls).toContain("Hi");
    } finally {
      setter.restore();
    }
  });

  it("appends at the end of an email input through the setter path", async () => {
    const user = userEvent.setup();
    const setter = spyNativeValueSetter();
    try {
      const el = makeInput("email");
      el.value = "me@";
      await user.click(el);
      if (el.selectionStart !== null) el.setSelectionRange(el.value.length, el.value.length);
      const target = createFieldTarget(el, "text");
      target.apply([{ kind: "text", text: "example" }]);
      // Appended at the end (with the usual separating space: "@" takes one).
      expect(el.value).toBe("me@ example");
      expect(setter.calls).toContain("me@ example");
    } finally {
      setter.restore();
    }
  });

  it("ignores layout on a single line and keeps line breaks in a textarea", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    await user.click(el);
    const target = createFieldTarget(el, "text");
    expect(target.apply([{ kind: "paragraph" }])).toBe("layout_ignored");
    expect(el.value).toBe("");
    const ta = makeTextarea();
    await user.click(ta);
    const area = createFieldTarget(ta, "multiline");
    expect(area.apply([{ kind: "line_break" }])).toBe("applied");
    expect(ta.value).toBe("\n");
  });

  it("does nothing on a secret target: no apply, no voice, scratch is empty", async () => {
    const user = userEvent.setup();
    const el = makeInput("password");
    await user.click(el);
    const target = createFieldTarget(el, "secret");
    expect(target.secret).toBe(true);
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    expect(target.apply([{ kind: "text", text: "hunter2" }])).toBeUndefined();
    expect(el.value).toBe("");
    expect(events).toEqual([]);
    expect(target.voice).toBeUndefined();
    expect(target.scratch?.()).toBe("empty");
  });

  it("runs undo/redo through execCommand and reports unavailable for the rest", async () => {
    const user = userEvent.setup();
    stubExecCommand();
    const el = makeInput();
    await user.click(el);
    const target = createFieldTarget(el, "text");
    expect(target.voice).toBeDefined();
    target.apply([{ kind: "text", text: "Hello." }]);
    expect(el.value).toBe("Hello.");
    expect(target.voice!({ id: "common.undo", polarity: null })).toBe("ran");
    expect(el.value).toBe("");
    expect(target.voice!({ id: "common.redo", polarity: null })).toBe("ran");
    expect(el.value).toBe("Hello.");
    expect(target.voice!({ id: "common.undo", polarity: null })).toBe("ran");
    expect(target.voice!({ id: "common.undo", polarity: null })).toBe("empty");
    expect(target.voice!({ id: "editor.bold", polarity: "on" })).toBe("unavailable");
    expect(el.value).toBe("");
  });

  it("scratches the last dictated sentence, refuses after an author edit, empties after reset", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    await user.click(el);
    const target = createFieldTarget(el, "text");
    target.apply([{ kind: "text", text: "Hello there." }]);
    expect(el.value).toBe("Hello there.");
    expect(target.scratch?.()).toBe("removed");
    expect(el.value).toBe("");
    target.apply([{ kind: "text", text: "Hello there." }]);
    // The author typed inside the dictated sentence: positions no longer hold.
    await user.keyboard(" typed");
    expect(target.scratch?.()).toBe("refused");
    expect(el.value).toBe("Hello there. typed");
    target.resetScratch?.();
    expect(target.scratch?.()).toBe("empty");
  });

  it("reads at most 256 characters before the caret", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    el.value = "x".repeat(500);
    await user.click(el);
    const target = createFieldTarget(el, "text");
    el.setSelectionRange(500, 500);
    expect(target.before()).toBe("x".repeat(FIELD_BEFORE_LIMIT));
    el.setSelectionRange(10, 10);
    expect(target.before()).toBe("x".repeat(10));
  });

  it("never shows partial text in the field", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    await user.click(el);
    const target = createFieldTarget(el, "text");
    const events: string[] = [];
    el.addEventListener("input", () => events.push("input"));
    target.showPartial("hel");
    expect(el.value).toBe("");
    expect(events).toEqual([]);
  });

  it("follows the app language", () => {
    const previous = useSettingsStore.getState().language;
    try {
      const el = makeInput();
      const target = createFieldTarget(el, "text");
      useSettingsStore.setState({ language: "es" });
      expect(target.language()).toBe("es");
      useSettingsStore.setState({ language: "en" });
      expect(target.language()).toBe("en");
    } finally {
      useSettingsStore.setState({ language: previous });
    }
  });

  it("is unavailable without focus, outside its layer, detached, or read-only", async () => {
    const user = userEvent.setup();
    const el = makeInput();
    const target = createFieldTarget(el, "text");
    // Not focused yet.
    expect(target.isAvailable?.()).toBe(false);
    await user.click(el);
    expect(target.isAvailable?.()).toBe(true);
    const inert = document.createElement("div");
    inert.setAttribute("inert", "");
    document.body.appendChild(inert);
    inert.appendChild(el);
    // Focus is lost moving across containers; focus again inside [inert].
    await user.click(el);
    expect(target.isAvailable?.()).toBe(false);
    document.body.appendChild(el);
    await user.click(el);
    expect(target.isAvailable?.()).toBe(true);
    const hidden = document.createElement("div");
    hidden.setAttribute("aria-hidden", "true");
    document.body.appendChild(hidden);
    hidden.appendChild(el);
    await user.click(el);
    expect(target.isAvailable?.()).toBe(false);
    document.body.appendChild(el);
    el.remove();
    expect(target.isAvailable?.()).toBe(false);
    document.body.appendChild(el);
    await user.click(el);
    el.readOnly = true;
    expect(target.isAvailable?.()).toBe(false);
  });
});

describe("installDictationFieldTracker", () => {
  let register: ReturnType<typeof vi.fn<(target: DictationTarget) => () => void>>;
  let focus: ReturnType<typeof vi.fn<(targetId: string) => void>>;
  let registered: Map<string, DictationTarget>;
  let unregisters: Map<string, ReturnType<typeof vi.fn>>;
  let uninstall: (() => void) | null = null;

  function installSpySession() {
    registered = new Map();
    unregisters = new Map();
    register = vi.fn<(target: DictationTarget) => () => void>((target) => {
      registered.set(target.id, target);
      const spy = vi.fn(() => {
        registered.delete(target.id);
      });
      unregisters.set(target.id, spy);
      return () => {
        spy();
      };
    });
    focus = vi.fn<(targetId: string) => void>();
    const session = {
      register,
      focus,
      stop: vi.fn(async () => {}),
      getSnapshot: () => ({
        status: "idle" as const,
        language: null,
        modelId: null,
        level: 0,
        hasTarget: true,
        recording: false,
      }),
    };
    attachSession(session);
    return session;
  }

  function lastId(): string {
    return register.mock.calls[register.mock.calls.length - 1][0].id as string;
  }

  beforeEach(() => {
    installSpySession();
    uninstall = installDictationFieldTracker();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("registers and focuses each eligible kind", async () => {
    const user = userEvent.setup();
    const password = makeInput("password");
    const cases: Array<{
      make: () => HTMLInputElement | HTMLTextAreaElement;
      secret: boolean;
    }> = [
      { make: () => makeInput(), secret: false },
      { make: () => makeInput("search"), secret: false },
      { make: makeTextarea, secret: false },
      { make: () => password, secret: true },
    ];
    let count = 0;
    for (const { make, secret } of cases) {
      const el = make();
      await user.click(el);
      count += 1;
      expect(register).toHaveBeenCalledTimes(count);
      const id = lastId();
      expect(registered.has(id)).toBe(true);
      expect(focus).toHaveBeenCalledWith(id);
      expect(registered.get(id)?.secret).toBe(secret);
      el.remove();
    }
    expect(password).toBeDefined();
  });

  it("ignores number, opted-out, readOnly, and disabled fields", async () => {
    const user = userEvent.setup();
    const number = makeInput("number");
    await user.click(number);
    const off = makeInput("text");
    off.setAttribute("data-dictation", "off");
    await user.click(off);
    const ro = makeInput("text");
    ro.readOnly = true;
    await user.click(ro);
    const disabled = makeInput("text");
    disabled.disabled = true;
    await user.click(disabled);
    expect(register).not.toHaveBeenCalled();
    expect(registered.size).toBe(0);
  });

  it("registers the new field before unregistering the old one", async () => {
    const user = userEvent.setup();
    const a = makeInput();
    await user.click(a);
    const idA = lastId();
    const unregisterA = unregisters.get(idA)!;
    const b = makeInput();
    await user.click(b);
    expect(register).toHaveBeenCalledTimes(2);
    const idB = lastId();
    expect(focus).toHaveBeenLastCalledWith(idB);
    expect(unregisterA).toHaveBeenCalledTimes(1);
    expect(registered.has(idA)).toBe(false);
    expect(registered.has(idB)).toBe(true);
  });

  it("refocusing the same field focuses without re-registering", async () => {
    const user = userEvent.setup();
    const a = makeInput();
    await user.click(a);
    const idA = lastId();
    await user.click(document.body);
    await user.click(a);
    expect(register).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenLastCalledWith(idA);
  });

  it("tracks the already-focused field on install", () => {
    uninstall?.();
    resetDictationHubForTests();
    installSpySession();
    const a = makeInput();
    // Autofocus before install, not a user: no focusin fires after install listens.
    a.focus();
    expect(register).not.toHaveBeenCalled();
    uninstall = installDictationFieldTracker();
    expect(register).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(lastId());
    expect(registered.get(lastId())).toBeDefined();
    void a;
  });

  it("uninstall unregisters and stops listening", async () => {
    const user = userEvent.setup();
    const a = makeInput();
    await user.click(a);
    expect(registered.size).toBe(1);
    uninstall?.();
    uninstall = null;
    expect(registered.size).toBe(0);
    const c = makeInput();
    await user.click(c);
    expect(register).toHaveBeenCalledTimes(1);
  });
});
