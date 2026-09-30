import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import { Editor as WritingEditor } from "@/components/editor/Editor";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { selectionKeptPluginKey } from "@/components/editor/extensions/SelectionKept";
import { useModalStore } from "@/components/ui/modal-store";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";
import { useSettingsStore } from "@/features/settings/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import {
  DEFAULT_TOOLBAR_CONFIG,
  setGroupToolbarVisible,
  type ToolbarConfig,
} from "@/features/settings/toolbar-config";
import { useTutorialStore } from "@/features/tutorial/store";

vi.mock("@/components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return { SpellCheck: Extension.create({ name: "mockSpellCheck" }) };
});

// The real Editor for the Link round trip below. Only the parts around the
// Selection toolbar are stubbed; the Link dialog and the bubble stay real.
vi.mock("@/features/metrics/programmatic", () => ({ setContentSilently: vi.fn() }));
vi.mock("@/components/editor/EditorToolbar", () => ({ EditorToolbar: () => null }));
vi.mock("@/components/editor/LinkClickHandler", () => ({ LinkClickHandler: () => null }));
vi.mock("@/components/editor/ImageContextMenu", () => ({ ImageContextMenu: () => null }));
vi.mock("@/components/editor/MarkdownPasteDialog", () => ({
  MarkdownPasteDialog: () => null,
}));
vi.mock("@/components/editor/FootnoteList", () => ({ FootnoteList: () => null }));

// The real strings: the toolbar's accessible name is part of what is asserted.
vi.mock("react-i18next", async (importOriginal) => {
  const { default: en } = await import("@/locales/en.json");
  const lookup = (key: string): unknown =>
    key.split(".").reduce<unknown>(
      (node, part) =>
        node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
      en
    );
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({ t: (key: string) => lookup(key) ?? key }),
  };
});

const TOOLBAR_NAME = "Selection formatting";

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

/** jsdom has no layout, so the bubble needs a visible editor area to sit in. */
function scrollContainerRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    bottom: 500,
    left: 0,
    right: 800,
    width: 800,
    height: 500,
    toJSON: () => ({}),
  } as DOMRect;
}

function mountSelectionToolbar(config: ToolbarConfig = DEFAULT_TOOLBAR_CONFIG) {
  useSettingsStore.setState({ toolbarConfig: config });

  const host = document.createElement("div");
  host.className = "overflow-auto";
  host.getBoundingClientRect = scrollContainerRect;
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
  editor.view.coordsAtPos = () =>
    ({ top: 100, bottom: 120, left: 50, right: 60 }) as unknown as DOMRect;

  // A field outside the editor: the Command is bound only while the text has
  // focus, so the tests need somewhere else for focus to go.
  render(
    <>
      <input aria-label="Outside field" />
      <SelectionToolbar editor={editor as never} onLinkClick={vi.fn()} />
    </>
  );
  return { editor, host };
}

/** A click on the text lands focus on the editor's own DOM node. */
function focusText(editor: Editor) {
  editor.view.focus();
}

/**
 * Focuses the editor and selects "Hello". The selection itself comes from the
 * editor's own command: user-event moves the caret but does not extend a
 * selection with Shift (its `moveSelection` has shift as a TODO), so the
 * keyboard gesture that made this selection cannot be simulated here.
 */
function selectHello(editor: Editor) {
  act(() => {
    focusText(editor);
    editor.commands.setTextSelection({ from: 1, to: 6 });
  });
}

function scroll(host: HTMLElement) {
  act(() => {
    host.dispatchEvent(new Event("scroll"));
  });
}

function toolbar() {
  return screen.getByRole("toolbar", { name: TOOLBAR_NAME });
}

function isBound() {
  return Object.keys(useBoundShortcutStore.getState().counts).includes(
    "editor.focusSelectionToolbar"
  );
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

describe("SelectionToolbar keyboard operation", () => {
  it("moves focus into the floating toolbar with its Command, keeping the selection", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    expect(document.activeElement).toBe(editor.view.dom);

    await user.keyboard("{Alt>}{F10}{/Alt}");

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
    expect(toolbar().contains(document.activeElement)).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });

  it("moves focus between controls with the arrow, Home and End keys", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const first = document.activeElement;

    await user.keyboard("{ArrowRight}");
    const second = document.activeElement;
    expect(second).not.toBe(first);
    expect(toolbar().contains(second)).toBe(true);

    await user.keyboard("{End}");
    const last = document.activeElement;
    expect(last).not.toBe(second);
    expect(toolbar().contains(last)).toBe(true);

    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(last);
  });

  it("bolds the selection from the keyboard and keeps focus on the Bold button", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const bold = screen.getByRole("button", { name: "Bold" });

    await user.keyboard("{Enter}");

    expect(editor.isActive("bold")).toBe(true);
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
    expect(document.activeElement).toBe(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });

  it("bolds from a mouse click and keeps the caret in the text", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    expect(document.activeElement).toBe(editor.view.dom);

    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(editor.isActive("bold")).toBe(true);
    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the editor with the same selection on Escape", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(toolbar().contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");

    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });

  it("reaches a group hidden from the main toolbar entirely from the bubble", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar(
      setGroupToolbarVisible(DEFAULT_TOOLBAR_CONFIG, "basic-marks", false)
    );

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    const bold = within(toolbar()).getByRole("button", { name: "Bold" });
    expect(document.activeElement).toBe(bold);

    await user.keyboard("{Enter}");

    expect(editor.getHTML()).toContain("<strong>Hello</strong>");
    expect(document.activeElement).toBe(bold);
  });

  it("does nothing with an empty selection: no toolbar, focus stays in the editor", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();
    act(() => {
      focusText(editor);
    });

    expect(screen.queryByRole("toolbar")).toBeNull();

    await user.keyboard("{Alt>}{F10}{/Alt}");

    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("fires from a Custom Shortcut instead of the Default one", async () => {
    const user = userEvent.setup();
    act(() => {
      // A Custom Shortcut is a list of chords, each a list of steps.
      useShortcutSettingsStore
        .getState()
        .setCommandShortcuts("editor.focusSelectionToolbar", [["Alt+F9"]]);
    });
    const { editor } = mountSelectionToolbar();

    selectHello(editor);

    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(document.activeElement).toBe(editor.view.dom);

    await user.keyboard("{Alt>}{F9}{/Alt}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
  });

  it("declares its Command as a Bound Shortcut only while it is shown", async () => {
    const { editor } = mountSelectionToolbar();

    act(() => {
      focusText(editor);
    });
    expect(isBound()).toBe(false);

    selectHello(editor);
    expect(isBound()).toBe(true);

    act(() => {
      editor.commands.setTextSelection(1);
    });
    expect(isBound()).toBe(false);
  });

  it("binds its Command only while the editor has focus", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    expect(isBound()).toBe(true);

    const outside = screen.getByRole("textbox", { name: "Outside field" });
    await user.click(outside);
    expect(document.activeElement).toBe(outside);

    await user.keyboard("{Alt>}{F10}{/Alt}");

    // The bubble is still shown, but the text is not what has focus, so the
    // Command is not a Bound Shortcut and its keys do nothing.
    expect(toolbar()).toBeInTheDocument();
    expect(document.activeElement).toBe(outside);
    expect(isBound()).toBe(false);
  });

  it("stays visible while focus is inside it, and hides again once focus is back in the text", async () => {
    const user = userEvent.setup();
    const { editor, host } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(toolbar()).toBeInTheDocument();

    // The selection scrolls out of view: the bubble keeps its place while it
    // owns focus, so its controls stay reachable.
    act(() => {
      editor.view.coordsAtPos = () =>
        ({ top: -400, bottom: -380, left: 50, right: 60 }) as unknown as DOMRect;
    });
    scroll(host);
    expect(toolbar()).toBeInTheDocument();

    act(() => {
      focusText(editor);
    });
    scroll(host);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("lands back in the text, on the same selection, after the Link dialog closes", async () => {
    const user = userEvent.setup();
    let editor: Editor | null = null;
    render(
      <WritingEditor
        content="<p>Hello world</p>"
        onUpdate={vi.fn()}
        onEditorReady={(instance) => {
          editor = instance as unknown as Editor;
        }}
      />
    );
    await waitFor(() => expect(editor).not.toBeNull());

    // jsdom has no layout: the bubble needs a visible editor area to sit in.
    const scroller = editor!.view.dom.closest(".overflow-auto") as HTMLElement;
    scroller.getBoundingClientRect = scrollContainerRect;
    editor!.view.coordsAtPos = () =>
      ({ top: 100, bottom: 120, left: 50, right: 60 }) as unknown as DOMRect;

    act(() => {
      editor!.view.focus();
      editor!.commands.setTextSelection({ from: 1, to: 6 });
    });
    await waitFor(() => expect(toolbar()).toBeInTheDocument());

    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));

    // The arrow walks the toolbar to the Link command.
    const link = within(toolbar()).getByRole("button", { name: "Insert Link" });
    for (let i = 0; i < 12 && document.activeElement !== link; i++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(document.activeElement).toBe(link);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(editor!.view.dom.contains(document.activeElement)).toBe(true));
    expect(editor!.state.selection.from).toBe(1);
    expect(editor!.state.selection.to).toBe(6);
  });
});

describe("SelectionToolbar keeps the selection visible", () => {
  async function arrowUntilFocused(
    user: { keyboard: (text: string) => Promise<void> },
    target: HTMLElement,
    max = 24
  ) {
    for (let i = 0; i < max && document.activeElement !== target; i++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(document.activeElement).toBe(target);
  }

  it("paints the selection only while focus is in the toolbar", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();

    await user.keyboard("{Alt>}{F10}{/Alt}");

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");
  });

  it("clears the paint on Escape and returns focus to the text", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");

    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(editor.view.dom.querySelector(".selection-kept")).toBeNull()
    );
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
  });

  it("keeps the paint across a Bold command run from the toolbar", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");

    await user.keyboard("{Enter}");

    expect(editor.isActive("bold")).toBe(true);
    const painted = Array.from(editor.view.dom.querySelectorAll(".selection-kept"))
      .map((element) => element.textContent ?? "")
      .join("");
    expect(painted).toBe("Hello");
    expect(toolbar().contains(document.activeElement)).toBe(true);
  });

  it("clears the paint when focus leaves the toolbar", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");

    act(() => {
      screen.getByLabelText("Outside field").focus();
    });

    await waitFor(() =>
      expect(editor.view.dom.querySelector(".selection-kept")).toBeNull()
    );
  });

  it("keeps the paint while the highlight color picker is open, and Escape applies nothing", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");

    const optionsTrigger = within(toolbar()).getByRole("button", {
      name: "{{label}} options",
    });
    await arrowUntilFocused(user, optionsTrigger);

    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("dialog", { name: "{{label}} options" });
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Focus moved from the bubble into a popover the bubble opened: the
    // blur-clear must have been cancelled, so the range stays painted.
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(editor.view.dom.dataset.colorPreview).toBeUndefined();
    expect(editor.isActive("highlight")).toBe(false);
    // Leaving the picker does not touch the text, so the paint stays until
    // focus returns to the editor or leaves the toolbar another way.
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");
  });

  it("keeps the paint while the Link dialog opened from the bubble is open, and clears it when the text regains focus", async () => {
    const user = userEvent.setup();
    let editor: Editor | null = null;
    render(
      <WritingEditor
        content="<p>Hello world</p>"
        onUpdate={vi.fn()}
        onEditorReady={(instance) => {
          editor = instance as unknown as Editor;
        }}
      />
    );
    await waitFor(() => expect(editor).not.toBeNull());

    // jsdom has no layout: the bubble needs a visible editor area to sit in.
    const scroller = editor!.view.dom.closest(".overflow-auto") as HTMLElement;
    scroller.getBoundingClientRect = scrollContainerRect;
    editor!.view.coordsAtPos = () =>
      ({ top: 100, bottom: 120, left: 50, right: 60 }) as unknown as DOMRect;

    act(() => {
      editor!.view.focus();
      editor!.commands.setTextSelection({ from: 1, to: 6 });
    });
    await waitFor(() => expect(toolbar()).toBeInTheDocument());

    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Bold" }));

    // The arrow walks the toolbar to the Link command.
    const link = within(toolbar()).getByRole("button", { name: "Insert Link" });
    for (let i = 0; i < 12 && document.activeElement !== link; i++) {
      await user.keyboard("{ArrowRight}");
    }
    expect(document.activeElement).toBe(link);

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    expect(editor!.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(editor!.view.dom.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect(editor!.view.dom.querySelector(".selection-kept")).toBeNull());
  });

  it("clears the paint when Tab leaves the toolbar, and shows none when the text is focused again", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);
    await user.keyboard("{Alt>}{F10}{/Alt}");
    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("Hello");

    await user.tab({ shift: true });

    expect(toolbar().contains(document.activeElement)).toBe(false);
    await waitFor(() => expect(editor.view.dom.querySelector(".selection-kept")).toBeNull());

    act(() => {
      editor.view.focus();
    });
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();
    expect(selectionKeptPluginKey.getState(editor.state)).toBe(false);
  });

  it("a mouse press on a bubble button paints nothing: focus stays in the text", async () => {
    const user = userEvent.setup();
    const { editor } = mountSelectionToolbar();

    selectHello(editor);

    await user.click(screen.getByRole("button", { name: "Bold" }));

    expect(editor.isActive("bold")).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();
  });
});
