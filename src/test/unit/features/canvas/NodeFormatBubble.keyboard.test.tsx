import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_TOOLBAR_CONFIG, type ToolbarConfig } from "@/features/settings/toolbar-config";
import { useTutorialStore } from "@/features/tutorial/store";

vi.mock("@/components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

// The real FormattingButtons (the controls the keyboard must reach); only the
// editors that open dialogs are stubbed.
vi.mock("@/components/editor", async () => {
  const { FormattingButtons } = await import("@/components/editor/FormattingButtons");
  return { FormattingButtons, LinkClickHandler: () => null, LinkDialog: () => null };
});

vi.mock("@/components/editor/LinkPreviewLayer", () => ({ LinkPreviewLayer: () => null }));

vi.mock("@/features/canvas/nodes/CanvasRichContentMenu", () => ({
  CanvasRichContentMenu: () => null,
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: [], loadBooks: vi.fn() }),
}));

vi.mock("@/features/chapters/store", () => ({
  getChapterForLinking: vi.fn(),
  listChaptersForBookLinking: vi.fn(),
}));

vi.mock("@/features/notes/store", () => ({
  useNoteStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ notes: [] }),
}));

vi.mock("@xyflow/react", () => ({
  useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

// The real strings: the controls' accessible names are part of what is asserted.
vi.mock("react-i18next", async (importOriginal) => {
  const { default: en } = await import("@/locales/en.json");
  const lookup = (key: string): unknown =>
    key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
        en
      );
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: (key: string) => lookup(key) ?? key }),
  };
});

const { NodeFormatBubble } = await import("@/features/canvas/nodes/NodeFormatBubble");

const TOOLBAR_NAME = "Selection formatting";

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

function mountBubble(options: { onToolbarLeave?: () => void; withOutsideField?: boolean } = {}) {
  const host = document.createElement("div");
  host.className = "canvas-node-content";
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  hosts.push(host);

  const editor = new Editor({
    extensions: createRichTextExtensions({
      onMarkdownPaste: () => {},
      footnoteStartIndex: 1,
      autoClose: false,
      dropcursor: false,
    }),
    content: "<p>Hello world</p>",
    element,
  });
  editors.push(editor);
  // jsdom has no layout: give the selection coordinates the bubble can use.
  editor.view.coordsAtPos = () =>
    ({ top: 100, bottom: 120, left: 50, right: 60 }) as unknown as DOMRect;

  render(
    <>
      {options.withOutsideField ? <input aria-label="Outside field" /> : null}
      <NodeFormatBubble editor={editor} onToolbarLeave={options.onToolbarLeave} />
    </>
  );
  return editor;
}

/** Focuses the text and selects "Hello", the way Shift+Arrow leaves it. */
function selectHello(editor: Editor) {
  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
}

function toolbar() {
  return screen.getByRole("toolbar", { name: TOOLBAR_NAME });
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  useSettingsStore.setState({ toolbarConfig: DEFAULT_TOOLBAR_CONFIG });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
  useBoundShortcutStore.setState({ counts: {} });
});

afterEach(() => {
  // Unmount before destroying: a control's cleanup reads the editor's view.
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.unstubAllGlobals();
});

describe("NodeFormatBubble keyboard operation", () => {
  it("moves focus into the bubble with its Command, keeping the selection painted", async () => {
    const user = userEvent.setup();
    const editor = mountBubble();

    selectHello(editor);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();

    await user.keyboard("{Alt>}{F10}{/Alt}");

    expect(document.activeElement).toBe(within(toolbar()).getByRole("button", { name: "Bold" }));
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    // The browser paints no selection while focus is in the bubble: the
    // selection-kept decoration does.
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");
  });

  it("walks the controls with the arrows and returns to the text on Escape", async () => {
    const user = userEvent.setup();
    const editor = mountBubble();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const first = document.activeElement;
    expect(first).toBe(within(toolbar()).getByRole("button", { name: "Bold" }));

    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).not.toBe(first);
    expect(toolbar().contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");

    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();
  });

  it("bolds the selection from the bubble and keeps focus there", async () => {
    const user = userEvent.setup();
    const editor = mountBubble();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const bold = within(toolbar()).getByRole("button", { name: "Bold" });

    await user.keyboard("{Enter}");

    expect(editor.isActive("bold")).toBe(true);
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
    expect(document.activeElement).toBe(bold);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });
});

describe("NodeFormatBubble with the Font and Line Height fields", () => {
  const fieldsConfig = (): ToolbarConfig => ({
    ...DEFAULT_TOOLBAR_CONFIG,
    selectionToolbar: ["basic-marks", "font", "line-height"],
  });

  function sizeField(): HTMLInputElement {
    return within(toolbar()).getByRole("combobox", { name: "Size" }) as HTMLInputElement;
  }

  function lineHeightField(): HTMLInputElement {
    return within(toolbar()).getByRole("combobox", { name: "Line height" }) as HTMLInputElement;
  }

  function chevronOf(field: HTMLInputElement): HTMLElement {
    return within(field.parentElement as HTMLElement).getByRole("button");
  }

  async function walkRightTo(
    user: ReturnType<typeof userEvent.setup>,
    target: HTMLElement,
    max = 16
  ) {
    for (let index = 0; index < max && document.activeElement !== target; index++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(document.activeElement).toBe(target);
  }

  it("walks the fields with the arrows, keeps their Home and End, and returns on Escape", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ toolbarConfig: fieldsConfig() });
    const editor = mountBubble();
    selectHello(editor);

    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(document.activeElement).toBe(within(toolbar()).getByRole("button", { name: "Bold" }));

    await walkRightTo(user, sizeField());
    expect(sizeField().selectionStart).toBe(sizeField().value.length);

    // Right at the edge crosses to Line Height, skipping the chevrons.
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(lineHeightField());

    // End inside the field is the field's own, so the caret keeps it.
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(lineHeightField());

    // Escape hands focus back to the text with the selection intact.
    await user.keyboard("{Escape}");
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });

  it("presses a list item without leaving the Text Node, and applies the pick", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ toolbarConfig: fieldsConfig() });
    const editor = mountBubble();
    selectHello(editor);

    await user.click(chevronOf(sizeField()));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "14" }));

    expect(editor.getHTML()).toContain("font-size: 14px");
    expect(toolbar()).toBeInTheDocument();
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    // The pick returned focus to the text, so the native selection paints again.
    await waitFor(() => expect(editor.view.dom.contains(document.activeElement)).toBe(true));
  });

  it("reports leaving the bubble when a press moves focus outside a field", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ toolbarConfig: fieldsConfig() });
    const onToolbarLeave = vi.fn();
    const editor = mountBubble({ onToolbarLeave, withOutsideField: true });
    selectHello(editor);

    await user.click(sizeField());
    expect(document.activeElement).toBe(sizeField());
    expect(onToolbarLeave).not.toHaveBeenCalled();

    await user.click(screen.getByRole("textbox", { name: "Outside field" }));

    await waitFor(() => expect(onToolbarLeave).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(editor.getHTML()).toBe("<p>Hello world</p>");
  });

  it("does not report leaving the bubble on Escape back to the text", async () => {
    const user = userEvent.setup();
    useSettingsStore.setState({ toolbarConfig: fieldsConfig() });
    const onToolbarLeave = vi.fn();
    const editor = mountBubble({ onToolbarLeave, withOutsideField: true });
    selectHello(editor);

    await user.click(sizeField());
    await user.keyboard("{Escape}");

    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    expect(toolbar()).toBeInTheDocument();

    // The next real leave is reported once, so the Escape reported none.
    await user.click(sizeField());
    await user.click(screen.getByLabelText("Outside field"));
    await waitFor(() => expect(onToolbarLeave).toHaveBeenCalledTimes(1));
  });
});
