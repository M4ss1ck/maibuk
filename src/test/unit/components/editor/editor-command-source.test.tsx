import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { Editor as CoreEditor } from "@tiptap/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@/components/editor/Editor";
import {
  canRunEditorCommand,
  runEditorCommand,
} from "@/components/editor/editor-commands";
import {
  editorCommandBindings,
  forgetEditor,
} from "@/components/editor/editor-command-source";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { useCommandPaletteStore } from "@/features/command-palette/store";
import { commandState, runCommand } from "@/lib/command-runner";
import { COMMAND_IDS, COMMANDS, type CommandDef } from "@/lib/shortcut-registry";
import { useModalStore } from "@/components/ui/modal-store";
import { useTutorialStore } from "@/features/tutorial/store";

const { mockSetContentSilently } = vi.hoisted(() => ({
  mockSetContentSilently: vi.fn(),
}));

// ProseMirror measures the selection while handling real keyboard events, but
// jsdom does not implement these geometry methods on every possible node.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};
const emptyRects = (): DOMRectList =>
  ({ 0: emptyRect, length: 1, item: () => emptyRect }) as unknown as DOMRectList;

for (const prototype of [Range.prototype, Text.prototype, Comment.prototype]) {
  const geometry = prototype as unknown as {
    getClientRects?: () => DOMRectList;
    getBoundingClientRect?: () => DOMRect;
  };
  geometry.getClientRects ??= emptyRects;
  geometry.getBoundingClientRect ??= () => emptyRect;
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        spellCheckEnabled: false,
        language: "en",
        editorShowBorder: false,
        editorAutoClose: true,
        metrics: { enabled: { writing: false } },
        promptMarkdownOnPaste: true,
      }),
    {
      getState: () => ({
        spellCheckEnabled: false,
        language: "en",
        editorShowBorder: false,
        editorAutoClose: true,
        metrics: { enabled: { writing: false } },
        promptMarkdownOnPaste: true,
      }),
    }
  ),
}));

vi.mock("../../../../features/metrics/programmatic", () => ({
  setContentSilently: mockSetContentSilently,
}));

vi.mock("../../../../components/editor/EditorToolbar", () => ({
  EditorToolbar: () => null,
}));

vi.mock("../../../../components/editor/SelectionToolbar", () => ({
  SelectionToolbar: () => null,
}));

vi.mock("../../../../components/editor/LinkClickHandler", () => ({
  LinkClickHandler: () => null,
}));

vi.mock("../../../../components/editor/LinkDialog", () => ({
  LinkDialog: () => null,
}));

vi.mock("../../../../components/editor/ImageContextMenu", () => ({
  ImageContextMenu: () => null,
}));

vi.mock("../../../../components/editor/FootnoteList", () => ({
  FootnoteList: () => null,
}));

vi.mock("../../../../components/editor/MarkdownPasteDialog", () => ({
  MarkdownPasteDialog: () => null,
}));

vi.mock("../../../../components/editor/extensions/SpellCheck", async () => {
  const { Extension } = await vi.importActual<typeof import("@tiptap/core")>("@tiptap/core");
  return {
    SpellCheck: Extension.create({ name: "mockSpellCheck" }),
  };
});

const coreEditors: CoreEditor[] = [];

function createCoreEditor(content = "<p>Hello world</p>") {
  const editor = new CoreEditor({
    element: document.createElement("div"),
    content,
    extensions: createRichTextExtensions({
      onMarkdownPaste: () => {},
      footnoteStartIndex: 1,
      spellCheck: { enabled: false, language: "en" },
      autoClose: false,
      dropcursor: false,
    } as Parameters<typeof createRichTextExtensions>[0]),
  });
  coreEditors.push(editor);
  return editor;
}

beforeEach(() => {
  // TipTap's focus command settles the DOM focus on the next animation frame;
  // run it synchronously so the palette's selection restore lands in the test.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  useCommandPaletteStore.setState({ isOpen: false });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useTutorialStore.setState({ status: "idle" });
});

afterEach(() => {
  for (const editor of coreEditors.splice(0)) editor.destroy();
  useCommandPaletteStore.setState({ isOpen: false });
  vi.unstubAllGlobals();
});

async function renderEditor(content = "", ariaLabel = "Text") {
  let editor: TiptapEditor | null = null;
  const user = userEvent.setup();
  const view = render(
    <>
      <Editor
        content={content}
        onUpdate={vi.fn()}
        ariaLabel={ariaLabel}
        onEditorReady={(instance) => {
          editor = instance;
        }}
      />
      <button type="button">Outside</button>
    </>
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor as unknown as TiptapEditor, user, ...view };
}

/** Types "hello world" with the keyboard; the selection itself comes from the
 * editor's own command (see SelectionToolbar.keyboard.test.tsx:115-120: user-event
 * does not extend a selection with Shift in jsdom; the real gesture rides in a later E2E slice). */
async function typeHelloWorld(editor: TiptapEditor, user: ReturnType<typeof userEvent.setup>) {
  act(() => {
    editor.view.dom.focus();
  });
  await user.keyboard("hello world");
  act(() => {
    editor.commands.setTextSelection({ from: 7, to: 12 });
  });
}

describe("canRunEditorCommand / runEditorCommand", () => {
  it("dry-runs bold without changing the document", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    expect(canRunEditorCommand(editor, "editor.bold")).toBe(true);
    expect(editor.getHTML()).toBe("<p>Hello world</p>");
  });

  it("runs bold the way the key does", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    expect(runEditorCommand(editor, "editor.bold")).toBe(true);
    expect(editor.getHTML()).toBe("<p>Hello <strong>world</strong></p>");
  });

  it("reports an unknown Command as not runnable and refuses to run it", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    expect(canRunEditorCommand(editor, "focus.next" as never)).toBe(false);
    expect(runEditorCommand(editor, "focus.next" as never)).toBe(false);
    expect(editor.getHTML()).toBe("<p>Hello world</p>");
  });

  it("reports dictation.stop from the hub, never by dry-running the editor", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection({ from: 7, to: 12 });

    // No session attached: idle, so nothing to stop.
    expect(canRunEditorCommand(editor, "dictation.stop")).toBe(false);
  });

  it("dry-runs indent through the same object it would run with", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection(2);

    expect(canRunEditorCommand(editor, "editor.increaseIndent")).toBe(true);
  });

  it("runs the heading toggle with its level argument", () => {
    const editor = createCoreEditor();
    editor.commands.setTextSelection(2);

    expect(runEditorCommand(editor, "editor.heading1")).toBe(true);
    expect(editor.isActive("heading", { level: 1 })).toBe(true);
  });
});

describe("editor command source", () => {
  it("runs palette bold on the restored selection and returns focus to the text", async () => {
    const { editor, user } = await renderEditor();
    await typeHelloWorld(editor, user);
    expect(editor.state.selection.from).toBe(7);
    expect(editor.state.selection.to).toBe(12);

    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Outside" }));

    const outcome = await runCommand("editor.bold", { source: "palette" });
    expect(outcome).toBe("ran");

    const html = editor.getHTML();
    expect(html).toContain("<strong>world</strong>");
    expect(html).not.toContain("<strong>hello");
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
  });

  it("matches pressing Mod+B on the same selection in a fresh render", async () => {
    const first = await renderEditor("", "First text");
    await typeHelloWorld(first.editor, first.user);
    await first.user.click(screen.getByRole("button", { name: "Outside" }));
    await runCommand("editor.bold", { source: "palette" });
    const viaPalette = first.editor.getHTML();
    first.unmount();

    const second = await renderEditor("", "Second text");
    await typeHelloWorld(second.editor, second.user);
    await second.user.keyboard("{Control>}b{/Control}");
    const viaKey = second.editor.getHTML();

    expect(viaPalette).toContain("<strong>world</strong>");
    expect(viaKey).toBe(viaPalette);
  });

  it("reports bold runnable in a paragraph and disabled inside a code block", async () => {
    const { editor } = await renderEditor("<p>Hello world</p>");
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection(2);
    });

    expect(commandState("editor.bold")).toBe("runnable");

    act(() => {
      editor.commands.toggleCodeBlock();
    });
    act(() => {
      editor.commands.setTextSelection(2);
    });

    expect(commandState("editor.bold")).toBe("disabled");
  });

  it("reports heading1 runnable, then hidden for every editor id after unmount", async () => {
    const { editor, unmount } = await renderEditor("<p>Hello world</p>");
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection(2);
    });

    expect(commandState("editor.heading1")).toBe("runnable");

    unmount();

    for (const id of COMMAND_IDS) {
      const definition: CommandDef = COMMANDS[id];
      if (definition.source !== "editor-keymap") continue;
      expect(commandState(id)).toBe("hidden");
    }
  });

  it("gives the bindings to the editor focused last", async () => {
    let first: TiptapEditor | null = null;
    let second: TiptapEditor | null = null;
    render(
      <>
        <Editor
          content="<p>alpha</p>"
          onUpdate={vi.fn()}
          ariaLabel="First text"
          onEditorReady={(instance) => {
            first = instance;
          }}
        />
        <Editor
          content="<p>hello world</p>"
          onUpdate={vi.fn()}
          ariaLabel="Second text"
          onEditorReady={(instance) => {
            second = instance;
          }}
        />
      </>
    );
    await waitFor(() => expect(first).not.toBeNull());
    await waitFor(() => expect(second).not.toBeNull());
    const firstEditor = first as unknown as TiptapEditor;
    const secondEditor = second as unknown as TiptapEditor;

    act(() => {
      firstEditor.view.dom.focus();
    });
    act(() => {
      secondEditor.view.dom.focus();
      secondEditor.commands.setTextSelection({ from: 7, to: 12 });
    });

    const outcome = await runCommand("editor.bold", { source: "palette" });
    expect(outcome).toBe("ran");
    expect(secondEditor.getHTML()).toContain("<strong>world</strong>");
    expect(firstEditor.getHTML()).toBe("<p>alpha</p>");
  });

  it("paints .selection-kept when the palette opens over a non-empty selection", async () => {
    const { editor } = await renderEditor("<p>Hello world</p>");
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    expect(editor.view.dom.querySelector(".selection-kept")).toBeNull();

    act(() => {
      useCommandPaletteStore.getState().open();
    });

    expect(editor.view.dom.querySelector(".selection-kept")).toHaveTextContent("world");
  });

  it("returns no bindings once the editor is forgotten", async () => {
    const { editor } = await renderEditor("<p>Hello world</p>");
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 7, to: 12 });
    });
    expect(editorCommandBindings(editor)).not.toHaveLength(0);

    act(() => {
      forgetEditor(editor);
    });
    expect(editorCommandBindings(editor)).toHaveLength(0);
  });
});
