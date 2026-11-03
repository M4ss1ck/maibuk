import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { undo, redo, undoDepth } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  canMoveChecked,
  outermostTaskListAt,
  TaskListOrder,
} from "@/components/editor/extensions/TaskListOrder";
import { canRunEditorCommand, runEditorCommand } from "@/components/editor/editor-commands";

const task = (checked: boolean, text: string, ...nested: string[]) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"></label><div><p>${text}</p>${nested.join("")}</div></li>`;
const taskList = (...items: string[]) => `<ul data-type="taskList">${items.join("")}</ul>`;
const bullets = (...items: string[]) =>
  `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function build(content: string): Editor {
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
  return editor;
}

/** The list structure only: `[x]`/`[ ]` per Task Item, text per paragraph. */
function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) return node.textContent;
  const children: string[] = [];
  node.forEach((child) => {
    children.push(outline(child));
  });
  const inner = children.join(" ");
  if (node.type.name === "taskItem") return `${node.attrs.checked ? "[x]" : "[ ]"}(${inner})`;
  // The trailing empty paragraph every document ends with.
  if (node.type.name === "doc") return inner.trim();
  if (node.type.name === "taskList") return `{${inner}}`;
  return `${node.type.name}(${inner})`;
}

function textPos(editor: Editor, text: string, offset = 0): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === text) found = pos + 1 + offset;
  });
  if (found === null) throw new Error(`no paragraph ${text}`);
  return found;
}

const caretParagraph = (editor: Editor) => editor.state.selection.$from.parent.textContent;

describe("moving checked items", () => {
  it("moves checked items to the bottom at every level, children staying with their parent", () => {
    const editor = build(
      taskList(task(true, "A", taskList(task(false, "A1"), task(true, "A2"))), task(false, "B"))
    );

    editor.commands.moveCheckedToBottom(textPos(editor, "B"));

    // The issue's example, where A's nested list is already in order.
    expect(outline(editor.state.doc)).toBe("{[ ](B) [x](A {[ ](A1) [x](A2)})}");
  });

  it("moves checked items to the top, sorting a nested list by its own checkboxes", () => {
    const editor = build(
      taskList(task(false, "A", taskList(task(false, "A1"), task(true, "A2"))), task(true, "B"))
    );

    editor.commands.moveCheckedToTop(textPos(editor, "A"));

    expect(outline(editor.state.doc)).toBe("{[x](B) [ ](A {[x](A2) [ ](A1)})}");
  });

  it("keeps relative order inside each group", () => {
    const editor = build(
      taskList(
        task(true, "c1"),
        task(false, "u1"),
        task(true, "c2"),
        task(false, "u2"),
        task(true, "c3")
      )
    );

    editor.commands.moveCheckedToBottom(textPos(editor, "c1"));

    expect(outline(editor.state.doc)).toBe("{[ ](u1) [ ](u2) [x](c1) [x](c2) [x](c3)}");
  });

  it("acts on the whole outermost list from a caret in a nested item", () => {
    const editor = build(
      taskList(task(true, "A", taskList(task(true, "A1"), task(false, "A2"))), task(false, "B"))
    );
    editor.commands.setTextSelection(textPos(editor, "A2"));

    editor.commands.moveCheckedToBottom();

    expect(outline(editor.state.doc)).toBe("{[ ](B) [x](A {[ ](A2) [x](A1)})}");
  });

  it("treats a Task List inside a bullet list as its own list, leaving the bullets alone", () => {
    const editor = build(
      bullets(`<p>one</p>${taskList(task(true, "c"), task(false, "u"))}`, "<p>two</p>")
    );
    editor.commands.setTextSelection(textPos(editor, "c"));

    editor.commands.moveCheckedToBottom();

    expect(outline(editor.state.doc)).toBe(
      "bulletList(listItem(one {[ ](u) [x](c)}) listItem(two))"
    );
  });

  it("does not reach through a bullet list into a Task List nested below it", () => {
    const inner = taskList(task(true, "in-c"), task(false, "in-u"));
    const editor = build(taskList(task(true, "c", bullets(`<p>b</p>${inner}`)), task(false, "u")));

    editor.commands.moveCheckedToBottom(textPos(editor, "u"));

    expect(outline(editor.state.doc)).toBe(
      "{[ ](u) [x](c bulletList(listItem(b {[x](in-c) [ ](in-u)})))}"
    );
  });

  it("reorders only the inner list from a caret inside it", () => {
    const inner = taskList(task(true, "in-c"), task(false, "in-u"));
    const editor = build(taskList(task(true, "c", bullets(`<p>b</p>${inner}`)), task(false, "u")));
    editor.commands.setTextSelection(textPos(editor, "in-c"));

    editor.commands.moveCheckedToBottom();

    expect(outline(editor.state.doc)).toBe(
      "{[x](c bulletList(listItem(b {[ ](in-u) [x](in-c)}))) [ ](u)}"
    );
  });
});

describe("nothing to move", () => {
  it.each([
    ["already in that order", taskList(task(true, "a"), task(false, "b")), "top"],
    ["already in that order", taskList(task(false, "a"), task(true, "b")), "bottom"],
    ["nothing checked", taskList(task(false, "a"), task(false, "b")), "top"],
    ["nothing unchecked", taskList(task(true, "a"), task(true, "b")), "bottom"],
  ] as const)("does nothing and writes nothing when %s", (_why, content, order) => {
    const editor = build(content);
    const pos = textPos(editor, "a");
    const before = editor.state.doc;
    let changes = 0;
    editor.on("update", () => {
      changes += 1;
    });

    expect(canMoveChecked(editor.state.doc, pos, order)).toBe(false);
    const ran =
      order === "top"
        ? editor.commands.moveCheckedToTop(pos)
        : editor.commands.moveCheckedToBottom(pos);

    expect(ran).toBe(false);
    expect(editor.state.doc).toBe(before);
    expect(changes).toBe(0);
  });

  it("still has something to move when only a nested level is out of order", () => {
    const editor = build(
      taskList(task(true, "a", taskList(task(true, "a1"), task(false, "a2"))), task(true, "b"))
    );

    expect(canMoveChecked(editor.state.doc, textPos(editor, "b"), "bottom")).toBe(true);
    expect(canMoveChecked(editor.state.doc, textPos(editor, "b"), "top")).toBe(false);
  });

  it("enables its Commands only inside a Task List with something to move", () => {
    const editor = build(`<p>plain</p>${taskList(task(false, "u"), task(true, "c"))}`);

    editor.commands.setTextSelection(textPos(editor, "plain"));
    expect(canRunEditorCommand(editor, "editor.moveCheckedToTop")).toBe(false);
    expect(canRunEditorCommand(editor, "editor.moveCheckedToBottom")).toBe(false);

    editor.commands.setTextSelection(textPos(editor, "u"));
    expect(canRunEditorCommand(editor, "editor.moveCheckedToTop")).toBe(true);
    expect(canRunEditorCommand(editor, "editor.moveCheckedToBottom")).toBe(false);
  });

  it("leaves its Commands off in an editor without the extension", () => {
    const editor = new Editor({
      extensions: createRichTextExtensions({ spellCheck: { enabled: false, language: "en" } }),
      content: "<p>chapter</p>",
    });
    editors.push(editor);

    expect(canRunEditorCommand(editor, "editor.moveCheckedToTop")).toBe(false);
  });

  it("does nothing in a read-only editor", () => {
    const editor = build(taskList(task(false, "u"), task(true, "c")));
    editor.setEditable(false);

    expect(editor.commands.moveCheckedToTop(textPos(editor, "u"))).toBe(false);
    expect(outline(editor.state.doc)).toBe("{[ ](u) [x](c)}");
  });

  it("answers no list for a position past the end of the document", () => {
    const editor = build(taskList(task(false, "u"), task(true, "c")));

    expect(outermostTaskListAt(editor.state.doc, editor.state.doc.content.size + 5)).toBeNull();
  });
});

describe("undo and the caret", () => {
  it("undoes the whole move in one step, even right after typing", () => {
    const editor = build(taskList(task(true, "c1"), task(false, "u1"), task(true, "c2")));
    editor.commands.setTextSelection(textPos(editor, "u1", 2));
    editor.commands.insertContent("x");
    const depth = undoDepth(editor.state);

    runEditorCommand(editor, "editor.moveCheckedToBottom");

    expect(undoDepth(editor.state)).toBe(depth + 1);
    expect(outline(editor.state.doc)).toBe("{[ ](u1x) [x](c1) [x](c2)}");
    undo(editor.state, editor.view.dispatch);
    expect(outline(editor.state.doc)).toBe("{[x](c1) [ ](u1x) [x](c2)}");
    expect(caretParagraph(editor)).toBe("u1x");
    redo(editor.state, editor.view.dispatch);
    expect(outline(editor.state.doc)).toBe("{[ ](u1x) [x](c1) [x](c2)}");
    expect(caretParagraph(editor)).toBe("u1x");
  });

  it("keeps the caret in its item at the same offset", () => {
    const editor = build(taskList(task(true, "checked"), task(false, "open")));
    editor.commands.setTextSelection(textPos(editor, "checked", 3));

    editor.commands.moveCheckedToBottom();

    expect(caretParagraph(editor)).toBe("checked");
    expect(editor.state.selection.$from.parentOffset).toBe(3);
  });

  it("keeps the caret in a nested item when both levels move", () => {
    const editor = build(
      taskList(task(true, "A", taskList(task(true, "A1"), task(false, "A2"))), task(false, "B"))
    );
    editor.commands.setTextSelection(textPos(editor, "A1", 1));

    editor.commands.moveCheckedToBottom();

    expect(outline(editor.state.doc)).toBe("{[ ](B) [x](A {[ ](A2) [x](A1)})}");
    expect(caretParagraph(editor)).toBe("A1");
    expect(editor.state.selection.$from.parentOffset).toBe(1);
  });

  it("keeps two identical items in order, so the caret stays in the one it was in", () => {
    const editor = build(taskList(task(true, "same"), task(true, "same"), task(false, "open")));
    let second = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "same") second = pos + 1;
    });
    editor.commands.setTextSelection(second);

    editor.commands.moveCheckedToBottom();

    expect(outline(editor.state.doc)).toBe("{[ ](open) [x](same) [x](same)}");
    let lastSame = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "same") lastSame = pos + 1;
    });
    expect(editor.state.selection.from).toBe(lastSame);
  });

  it("leaves a caret outside the list where it was", () => {
    const editor = build(`${taskList(task(true, "c"), task(false, "u"))}<p>after</p>`);
    editor.commands.setTextSelection(textPos(editor, "after", 2));

    editor.commands.moveCheckedToBottom(textPos(editor, "c"));

    expect(caretParagraph(editor)).toBe("after");
    expect(editor.state.selection.$from.parentOffset).toBe(2);
  });

  it("keeps a range selection on the same text inside one item", () => {
    const editor = build(taskList(task(true, "checked"), task(false, "open")));
    const from = textPos(editor, "checked", 1);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 3))
    );

    editor.commands.moveCheckedToBottom();

    const { from: nextFrom, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(nextFrom, to)).toBe("hec");
  });
});

describe("what the list shows and what it saves", () => {
  it("adds one ⋯ slot per outermost list, and one for a list inside a bullet", () => {
    const editor = build(
      `${taskList(task(false, "a", taskList(task(true, "a1"))))}<p>x</p>${bullets(
        `<p>b</p>${taskList(task(false, "c"))}`
      )}`
    );

    expect(editor.view.dom.querySelectorAll("[data-task-list-menu]")).toHaveLength(2);
    expect(editor.view.dom.querySelectorAll("ul.task-list-root")).toHaveLength(2);
  });

  it("marks the list holding the caret", () => {
    const editor = build(`${taskList(task(false, "a"))}<p>x</p>${taskList(task(false, "b"))}`);
    const marked = () =>
      Array.from(editor.view.dom.querySelectorAll("ul.task-list-caret")).map((list) =>
        list.textContent?.trim()
      );

    editor.commands.setTextSelection(textPos(editor, "b"));
    expect(marked()).toEqual(["b"]);

    editor.commands.setTextSelection(textPos(editor, "x"));
    expect(marked()).toEqual([]);
  });

  it("keeps the slot out of the HTML, the JSON, and the text", () => {
    const editor = build(taskList(task(false, "a"), task(true, "b")));
    editor.commands.moveCheckedToTop(textPos(editor, "a"));

    expect(editor.getHTML()).not.toContain("task-list");
    expect(JSON.stringify(editor.getJSON())).not.toContain("task-list");
    expect(editor.getText()).not.toContain("⋯");
  });

  it("shows no slot in a read-only editor", () => {
    const editor = build(taskList(task(false, "a")));

    editor.setEditable(false);

    expect(editor.view.dom.querySelectorAll("[data-task-list-menu]")).toHaveLength(0);
  });
});
