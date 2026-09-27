import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS, type CustomShortcuts } from "@/lib/shortcut-resolve";

vi.mock("@/components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

let editor: Editor;

function setCustom(custom: CustomShortcuts) {
  useShortcutSettingsStore.setState({ shortcuts: { version: 1, custom, singleKeyEnabled: true } });
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  editor.view.dom.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  editor = new Editor({
    element: document.createElement("div"),
    content: "<p>hello world</p>",
    extensions: createRichTextExtensions({
      onMarkdownPaste: () => {},
      footnoteStartIndex: 1,
      spellCheck: { enabled: false, language: "en" },
      autoClose: true,
      dropcursor: false,
    } as Parameters<typeof createRichTextExtensions>[0]),
  });
  editor.commands.selectAll();
});

afterEach(() => {
  editor.destroy();
});

describe("ShortcutOverrides", () => {
  it("keeps the extension's own key when nothing is customized", () => {
    press({ key: "b", ctrlKey: true });
    expect(editor.isActive("bold")).toBe(true);
  });

  it("runs a Command on its Custom Shortcut and retires the default key, without re-creating the editor", () => {
    const view = editor.view;
    setCustom({ "editor.bold": [["Mod+Shift+k"]] });

    const retired = press({ key: "b", ctrlKey: true });
    expect(editor.isActive("bold")).toBe(false);
    expect(retired.defaultPrevented).toBe(true);

    press({ key: "K", ctrlKey: true, shiftKey: true });
    expect(editor.isActive("bold")).toBe(true);
    expect(editor.view).toBe(view);
  });

  it("gives a default key to another Command", () => {
    setCustom({ "editor.bold": [["Mod+Shift+k"]], "editor.italic": [["Mod+b"]] });

    press({ key: "b", ctrlKey: true });
    expect(editor.isActive("italic")).toBe(true);
    expect(editor.isActive("bold")).toBe(false);
  });

  it("stops a key the author removed with No shortcut", () => {
    setCustom({ "editor.italic": [] });

    press({ key: "i", ctrlKey: true });
    expect(editor.isActive("italic")).toBe(false);
  });

  it("adds an extra Shortcut to Undo and keeps the Fixed Mod+Z", () => {
    setCustom({ "common.undo": [["F9"]] });
    press({ key: "b", ctrlKey: true });
    expect(editor.isActive("bold")).toBe(true);

    press({ key: "F9" });
    expect(editor.isActive("bold")).toBe(false);

    press({ key: "b", ctrlKey: true });
    press({ key: "z", ctrlKey: true });
    expect(editor.isActive("bold")).toBe(false);
  });

  it("runs a two-step Custom Shortcut", () => {
    setCustom({ "editor.bold": [["Mod+Alt+g", "Mod+Alt+1"]] });

    press({ key: "g", ctrlKey: true, altKey: true });
    press({ key: "1", ctrlKey: true, altKey: true });
    expect(editor.isActive("bold")).toBe(true);
  });

  it("runs a Command that takes arguments (heading level) on its Custom Shortcut", () => {
    setCustom({ "editor.heading2": [["Mod+Alt+q"]] });
    editor.commands.setTextSelection(2);

    press({ key: "q", ctrlKey: true, altKey: true });
    expect(editor.isActive("heading", { level: 2 })).toBe(true);
  });

  it("never runs a bare letter while the author types", () => {
    setCustom({ "editor.bold": [["k"]] });

    const typed = press({ key: "k" });
    expect(editor.isActive("bold")).toBe(false);
    expect(typed.defaultPrevented).toBe(false);
  });

  it("matches a non-Latin layout through the physical key", () => {
    setCustom({ "editor.bold": [["Mod+Shift+k"]] });

    press({ key: "Л", code: "KeyK", ctrlKey: true, shiftKey: true });
    expect(editor.isActive("bold")).toBe(true);
  });
});
