import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

import { useModalStore } from "@/components/ui/modal-store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { useTutorialStore } from "@/features/tutorial/store";
import { DEFAULT_SHORTCUT_SETTINGS, type CustomShortcuts } from "@/lib/shortcut-resolve";

const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => platform.mac,
}));

function setShortcuts(custom: CustomShortcuts, singleKeyEnabled = true) {
  useShortcutSettingsStore.setState({ shortcuts: { version: 2, voice: {}, custom, singleKeyEnabled } });
}

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  platform.mac = false;
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  useTutorialStore.setState({ status: "idle" });
});

describe("useShortcuts modal blocking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire shortcuts while any modal is open (listener removed)", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("does not fire allowInInput shortcuts while modal is open", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "bookEditor.focusMode", onTrigger, allowInInput: true }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", bubbles: true }));
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires shortcuts when no modal is open", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("re-enables shortcuts when the final modal closes (effect re-attaches listener)", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).not.toHaveBeenCalled();

    act(() => {
      useModalStore.setState({ modalIds: [], openCount: 0 });
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("fires a modifier shortcut even when a pressable stops keydown propagation", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    // React Spectrum pressables (React Aria menus, listboxes, toolbars) stop
    // keydown propagation, which would otherwise hide shortcut keys.
    const pressable = document.createElement("button");
    pressable.addEventListener("keydown", (event) => event.stopPropagation());
    document.body.appendChild(pressable);
    pressable.focus();

    pressable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).toHaveBeenCalledTimes(1);
    pressable.remove();
  });

  it("preserves sequence matching when no modal is open", async () => {
    useModalStore.setState({ modalIds: [], openCount: 0 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "global.gotoProjects", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("suppresses sequence matching while modal is open", async () => {
    useModalStore.setState({ modalIds: ["modal-1"], openCount: 1 });

    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "global.gotoProjects", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("discards a partial sequence when modal scope opens", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "global.gotoProjects", onTrigger }]));

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));

    act(() => {
      useModalStore.getState().register("modal-1");
    });
    act(() => {
      useModalStore.getState().unregister("modal-1");
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));

    expect(onTrigger).not.toHaveBeenCalled();
  });
});

describe("useShortcuts capture phase and typing targets", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("does not fire a Mod shortcut without allowInInput while focus is in a textbox", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).not.toHaveBeenCalled();
    input.remove();
  });

  it("does not fire a Mod shortcut without allowInInput while focus is in a contenteditable", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.appendChild(editable);

    editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).not.toHaveBeenCalled();
    editable.remove();
  });

  it("fires a shortcut exactly once when both capture and bubble listeners see the event", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    // A modifier combo reaches both the capture listener and the bubble
    // listener; the shared handled set keeps it from triggering twice.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })
    );

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});

describe("useShortcuts resolves keys from the registry and Custom Shortcuts", () => {
  beforeEach(() => {
    useModalStore.setState({ modalIds: [], openCount: 0 });
  });

  it("fires a rebound key and no longer fires the default key", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    setShortcuts({ "common.save": [["Mod+Shift+k"]] });

    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    press({ key: "s", ctrlKey: true });
    expect(onTrigger).not.toHaveBeenCalled();

    press({ key: "K", ctrlKey: true, shiftKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("picks up a change made while the binding is mounted", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "global.showHelp", onTrigger }]));

    press({ key: "?", shiftKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    act(() => setShortcuts({ "global.showHelp": [["F1"]] }));
    press({ key: "?", shiftKey: true });
    press({ key: "F1" });
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a Command set to No shortcut", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    setShortcuts({ "common.save": [] });
    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    press({ key: "s", ctrlKey: true });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("fires an extra Shortcut on a Command with a Fixed Shortcut, and keeps the Fixed one", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    setShortcuts({ "common.undo": [["F9"]] });
    renderHook(() => useShortcuts([{ id: "common.undo", onTrigger }]));

    press({ key: "F9" });
    press({ key: "z", ctrlKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("ignores Custom Shortcuts on a Sealed Command", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    setShortcuts({ "bookList.openSelected": [["o"]] } as CustomShortcuts);
    renderHook(() => useShortcuts([{ id: "bookList.openSelected", onTrigger }]));

    press({ key: "o" });
    expect(onTrigger).not.toHaveBeenCalled();
    press({ key: "Enter" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("records a rebound two-key sequence", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    setShortcuts({ "bookEditor.saveVersion": [["g", "k"]] });
    renderHook(() => useShortcuts([{ id: "bookEditor.saveVersion", onTrigger }]));

    press({ key: "g" });
    press({ key: "k" });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    press({ key: "s", ctrlKey: true, altKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("drops a sequence whose second key comes after the timeout", async () => {
    vi.useFakeTimers();
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "global.gotoProjects", onTrigger }]));

    press({ key: "g" });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    press({ key: "p" });
    expect(onTrigger).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("still suppresses a rebound key in a typing target unless the binding allows input", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const blocked = vi.fn();
    const allowed = vi.fn();
    setShortcuts({ "common.save": [["Mod+Shift+k"]], "global.syncNow": [["Mod+Shift+j"]] });
    renderHook(() =>
      useShortcuts([
        { id: "common.save", onTrigger: blocked },
        { id: "global.syncNow", onTrigger: allowed, allowInInput: true },
      ])
    );
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    press({ key: "K", ctrlKey: true, shiftKey: true }, input);
    press({ key: "J", ctrlKey: true, shiftKey: true }, input);

    expect(blocked).not.toHaveBeenCalled();
    expect(allowed).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("fires only tutorial.skip, including its extra Shortcut, while a Tutorial runs", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const skip = vi.fn();
    const help = vi.fn();
    setShortcuts({ "tutorial.skip": [["F4"]] });
    useTutorialStore.setState({ status: "running" } as never);
    renderHook(() =>
      useShortcuts([
        { id: "tutorial.skip", onTrigger: skip },
        { id: "global.showHelp", onTrigger: help },
      ])
    );

    press({ key: "?", shiftKey: true });
    press({ key: "F4" });
    press({ key: "Escape" });

    expect(help).not.toHaveBeenCalled();
    expect(skip).toHaveBeenCalledTimes(2);
  });

  it("turns off single-key Shortcuts but keeps Fixed ones and modifier ones", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const help = vi.fn();
    const pen = vi.fn();
    const goto = vi.fn();
    const skip = vi.fn();
    const sync = vi.fn();
    setShortcuts({}, false);
    renderHook(() =>
      useShortcuts([
        { id: "global.showHelp", onTrigger: help },
        { id: "canvas.toolPen", onTrigger: pen },
        { id: "global.gotoProjects", onTrigger: goto },
        { id: "tutorial.skip", onTrigger: skip },
        { id: "global.syncNow", onTrigger: sync },
      ])
    );

    press({ key: "?", shiftKey: true });
    press({ key: "p" });
    press({ key: "g" });
    press({ key: "p" });
    press({ key: "Escape" });
    press({ key: "Y", ctrlKey: true, shiftKey: true });

    expect(help).not.toHaveBeenCalled();
    expect(pen).not.toHaveBeenCalled();
    expect(goto).not.toHaveBeenCalled();
    expect(skip).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("ignores keys pressed while an input method is composing", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "global.showHelp", onTrigger }]));

    press({ key: "?", keyCode: 229 });
    press({ key: "?", isComposing: true });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("matches the physical key when the layout types a non-Latin letter", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    press({ key: "ы", code: "KeyS", ctrlKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("keeps a Latin layout's own letter instead of the physical key", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    // Dvorak: the key printed "s" in QWERTY position types "o".
    press({ key: "o", code: "KeyS", ctrlKey: true });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reads Mod as Cmd on macOS and Ctrl elsewhere", async () => {
    const { useShortcuts } = await import("@/lib/shortcuts");
    const onTrigger = vi.fn();
    renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));

    press({ key: "s", metaKey: true });
    expect(onTrigger).not.toHaveBeenCalled();
    press({ key: "s", ctrlKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    platform.mac = true;
    const { unmount } = renderHook(() => useShortcuts([{ id: "common.save", onTrigger }]));
    // Only the macOS binding reads Cmd+S; the other still wants Ctrl.
    press({ key: "s", metaKey: true });
    expect(onTrigger).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("uses the web default where the browser keeps the desktop key", async () => {
    const { liveShortcuts } = await import("@/lib/command-keys");
    expect(liveShortcuts("bookList.newBook", DEFAULT_SHORTCUT_SETTINGS, true)).toEqual([["Alt+n"]]);
    expect(liveShortcuts("bookList.newBook", DEFAULT_SHORTCUT_SETTINGS, false)).toEqual([["Mod+n"]]);
  });
});
