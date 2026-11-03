import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, type Editor as ReactEditor } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorContextMenu } from "@/components/editor/EditorContextMenu";
import { TaskListMenus } from "@/components/editor/TaskListMenus";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { TaskListOrder } from "@/components/editor/extensions/TaskListOrder";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const task = (checked: boolean, text: string) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"></label><div><p>${text}</p></div></li>`;
const taskList = (...items: string[]) => `<ul data-type="taskList">${items.join("")}</ul>`;

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

async function renderEditor(content: string, ui: (editor: ReactEditor) => React.ReactNode) {
  const editor = new Editor({
    extensions: [
      ...createRichTextExtensions({ spellCheck: { enabled: false, language: "en" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TaskListOrder,
    ],
    content,
  });
  editors.push(editor);
  const reactEditor = editor as unknown as ReactEditor;
  render(
    <>
      <EditorContent editor={reactEditor} />
      {ui(reactEditor)}
    </>
  );
  await waitFor(() => expect(editor.view.dom.isConnected).toBe(true));
  return editor;
}

const texts = (editor: Editor) => {
  const found: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isTextblock && node.textContent) found.push(node.textContent);
  });
  return found;
};

function textPos(editor: Editor, text: string): number {
  let found = 0;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) found = pos + 1;
  });
  return found;
}

describe("the ⋯ button", () => {
  it("opens from the keyboard, runs the action, and hands focus back to the text", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(taskList(task(true, "c"), task(false, "u")), (e) => (
      <TaskListMenus editor={e} />
    ));
    const trigger = await screen.findByRole("button", { name: "editor.taskListActions" });

    act(() => trigger.focus());
    await user.keyboard("{Enter}");
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "editor.moveCheckedToTop",
      "editor.moveCheckedToBottom",
    ]);
    // Already at the top, so that entry is disabled and focus lands on the other.
    expect(items[0]).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(items[1]);

    await user.keyboard("{Enter}");

    expect(texts(editor)).toEqual(["u", "c"]);
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });

  it("closes on Escape without moving anything", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(taskList(task(true, "c"), task(false, "u")), (e) => (
      <TaskListMenus editor={e} />
    ));
    const trigger = await screen.findByRole("button", { name: "editor.taskListActions" });

    act(() => trigger.focus());
    await user.keyboard("{Enter}");
    await screen.findAllByRole("menuitem");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    expect(texts(editor)).toEqual(["c", "u"]);
  });

  it("acts on the list it belongs to, not the list holding the caret", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(
      `${taskList(task(true, "c1"), task(false, "u1"))}<p>x</p>${taskList(
        task(true, "c2"),
        task(false, "u2")
      )}`,
      (e) => <TaskListMenus editor={e} />
    );
    editor.commands.setTextSelection(textPos(editor, "c1"));
    const triggers = await screen.findAllByRole("button", { name: "editor.taskListActions" });
    expect(triggers).toHaveLength(2);

    act(() => triggers[1].focus());
    await user.keyboard("{Enter}");
    await screen.findAllByRole("menuitem");
    await user.keyboard("{Enter}");

    expect(texts(editor)).toEqual(["c1", "u1", "x", "u2", "c2"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("c1");
  });

  it("keeps its button when the editor rebuilds its DOM with no transaction", async () => {
    const editor = await renderEditor(taskList(task(false, "a")), (e) => (
      <TaskListMenus editor={e} />
    ));
    await screen.findByRole("button", { name: "editor.taskListActions" });

    // New node views redraw the whole document, as an Editor re-render's options can.
    act(() => {
      editor.view.setProps({
        nodeViews: { horizontalRule: () => ({ dom: document.createElement("hr") }) },
      });
    });

    await waitFor(() => {
      const button = screen.getByRole("button", { name: "editor.taskListActions" });
      expect(editor.view.dom.contains(button)).toBe(true);
    });
  });

  it("follows lists added and removed, and renders nothing without a list", async () => {
    const editor = await renderEditor("<p>plain</p>", (e) => <TaskListMenus editor={e} />);
    expect(screen.queryByRole("button", { name: "editor.taskListActions" })).toBeNull();

    act(() => {
      editor.commands.setContent(taskList(task(false, "a")));
    });
    await screen.findByRole("button", { name: "editor.taskListActions" });

    act(() => {
      editor.commands.setContent("<p>plain</p>");
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "editor.taskListActions" })).toBeNull()
    );
  });
});

describe("the editor's menu", () => {
  const openAtCaret = async (user: ReturnType<typeof userEvent.setup>, editor: Editor) => {
    act(() => editor.view.focus());
    await user.keyboard("{Shift>}{F10}{/Shift}");
    return screen.findByRole("menu");
  };
  const menu = (e: ReactEditor) => (
    <EditorContextMenu editor={e} onInspect={() => {}} onLookup={() => {}} />
  );

  it("moves the list at the caret from Shift+F10, by keyboard alone", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(taskList(task(true, "c"), task(false, "u")), menu);
    editor.commands.setTextSelection(textPos(editor, "c"));

    await openAtCaret(user, editor);
    const bottom = screen.getByRole("menuitem", { name: "editor.moveCheckedToBottom" });
    expect(screen.getByRole("menuitem", { name: "editor.moveCheckedToTop" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    while (document.activeElement !== bottom) await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(texts(editor)).toEqual(["u", "c"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("c");
    await waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
  });

  it("anchors at the pointer low on the screen, leaving the flip to the popover", async () => {
    const editor = await renderEditor(`<p>plain</p>`, menu);
    const pos = textPos(editor, "plain");
    editor.view.posAtCoords = vi.fn(() => ({ pos, inside: pos }));
    const clientY = window.innerHeight - 10;

    fireEvent.contextMenu(editor.view.dom, { clientX: 40, clientY });

    await screen.findByRole("menu");
    const anchor = document.querySelector<HTMLElement>('button[aria-label="editor.contextMenu"]');
    expect(anchor?.style.top).toBe(`${clientY}px`);
    expect(anchor?.style.left).toBe("40px");
  });

  it("has no Task List section outside a Task List", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(`<p>plain</p>${taskList(task(false, "u"))}`, menu);
    editor.commands.setTextSelection(textPos(editor, "plain"));

    await openAtCaret(user, editor);

    expect(screen.queryByRole("menuitem", { name: "editor.moveCheckedToTop" })).toBeNull();
  });

  it("acts on the list it was opened from with a right click", async () => {
    const user = userEvent.setup();
    const editor = await renderEditor(
      `<p>away</p>${taskList(task(true, "c"), task(false, "u"))}`,
      menu
    );
    editor.commands.setTextSelection(textPos(editor, "away"));
    const pos = textPos(editor, "c");
    editor.view.posAtCoords = vi.fn(() => ({ pos, inside: pos }));

    await user.pointer({ keys: "[MouseRight]", target: editor.view.dom });
    await user.click(await screen.findByRole("menuitem", { name: "editor.moveCheckedToBottom" }));

    expect(texts(editor)).toEqual(["away", "u", "c"]);
    expect(editor.state.selection.$from.parent.textContent).toBe("away");
  });
});
