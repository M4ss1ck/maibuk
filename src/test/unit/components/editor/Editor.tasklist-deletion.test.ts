import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { afterEach, describe, expect, it } from "vitest";

import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const BASE_CONTENT =
  '<p>Previous line</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task text</p></li></ul>';
const EMPTY_CONTENT =
  '<p>Previous line</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>';
const TWO_CONTENT =
  '<p>Previous line</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>First</p></li><li data-type="taskItem" data-checked="false"><p>Second</p></li></ul>';
const NESTED_CONTENT =
  '<p>Previous line</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Outer</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Inner</p></li></ul></li></ul>';
const TWO_PARAGRAPH_CONTENT =
  '<p>Previous line</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>One</p><p>Two</p></li></ul>';

function makeEditorWith(content: string) {
  const editor = new Editor({
    extensions: [...createRichTextExtensions(), TaskList, TaskItem.configure({ nested: true })],
    content,
  });
  editors.push(editor);
  return editor;
}

function makeEditor() {
  const editor = makeEditorWith(BASE_CONTENT);
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "Task text") editor.commands.setTextSelection(pos);
  });
  return editor;
}

/** Positions (node starts) of every taskItem in document order. */
function taskItemPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "taskItem") positions.push(pos);
  });
  return positions;
}

/** Collapsed cursor at the start of the index-th taskItem's first paragraph. */
function cursorAtTaskItem(editor: Editor, index: number) {
  editor.commands.setTextSelection(taskItemPositions(editor)[index] + 2);
}

/** Collapsed cursor inside `text` at the given offset. */
function cursorInText(editor: Editor, text: string, offset: number) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text === text) from = pos;
  });
  expect(from).toBeGreaterThan(-1);
  editor.commands.setTextSelection(from + offset);
}

/** Select the full run of `text`. */
function selectText(editor: Editor, text: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text === text) from = pos;
  });
  expect(from).toBeGreaterThan(-1);
  editor.commands.setTextSelection({ from, to: from + text.length });
}

function dispatchBackspace(editor: Editor) {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      keyCode: 8,
      bubbles: true,
      cancelable: true,
    })
  );
}

function dispatchBeforeinput(
  editor: Editor,
  init: InputEventInit & { isComposing?: boolean } = {}
): InputEvent {
  const event = new InputEvent("beforeinput", {
    inputType: "deleteContentBackward",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  if (init.isComposing !== undefined) {
    Object.defineProperty(event, "isComposing", { value: init.isComposing });
  }
  editor.view.dom.dispatchEvent(event);
  return event;
}

function countTaskItems(editor: Editor): number {
  return (editor.getHTML().match(/data-type="taskItem"/g) ?? []).length;
}

describe("task item deletion", () => {
  it("desktop Backspace removes the checkbox at the start of its text", () => {
    const editor = makeEditor();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        keyCode: 8,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(editor.getHTML()).not.toContain('data-type="taskItem"');
    expect(editor.state.doc.textContent).toBe("Previous lineTask text");
  });

  it("handles soft-keyboard backward deletion at the same boundary before native DOM mutation", () => {
    const editor = makeEditor();
    const event = new InputEvent("beforeinput", {
      inputType: "deleteContentBackward",
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    expect(editor.getHTML()).not.toContain('data-type="taskItem"');
    expect(editor.state.doc.textContent).toBe("Previous lineTask text");
    expect(event.defaultPrevented).toBe(true);
  });

  it("matches desktop Backspace for an empty task", () => {
    const viaKeyboard = makeEditorWith(EMPTY_CONTENT);
    cursorAtTaskItem(viaKeyboard, 0);
    dispatchBackspace(viaKeyboard);

    const viaSoftKeyboard = makeEditorWith(EMPTY_CONTENT);
    cursorAtTaskItem(viaSoftKeyboard, 0);
    const event = dispatchBeforeinput(viaSoftKeyboard);

    expect(event.defaultPrevented).toBe(true);
    expect(viaSoftKeyboard.getHTML()).toBe(viaKeyboard.getHTML());
    expect(viaSoftKeyboard.getHTML()).not.toContain('data-type="taskItem"');
    expect(viaSoftKeyboard.state.doc.textContent).toBe("Previous line");
  });

  it("matches desktop Backspace at the start of the second item", () => {
    const viaKeyboard = makeEditorWith(TWO_CONTENT);
    cursorInText(viaKeyboard, "Second", 0);
    dispatchBackspace(viaKeyboard);

    const viaSoftKeyboard = makeEditorWith(TWO_CONTENT);
    cursorInText(viaSoftKeyboard, "Second", 0);
    const event = dispatchBeforeinput(viaSoftKeyboard);

    expect(event.defaultPrevented).toBe(true);
    expect(viaSoftKeyboard.getHTML()).toBe(viaKeyboard.getHTML());
    expect(countTaskItems(viaSoftKeyboard)).toBe(1);
    expect(viaSoftKeyboard.state.doc.textContent).toBe("Previous lineFirstSecond");
  });

  it("matches desktop Backspace at the start of a nested item", () => {
    const viaKeyboard = makeEditorWith(NESTED_CONTENT);
    cursorInText(viaKeyboard, "Inner", 0);
    dispatchBackspace(viaKeyboard);

    const viaSoftKeyboard = makeEditorWith(NESTED_CONTENT);
    cursorInText(viaSoftKeyboard, "Inner", 0);
    const event = dispatchBeforeinput(viaSoftKeyboard);

    expect(event.defaultPrevented).toBe(true);
    expect(viaSoftKeyboard.getHTML()).toBe(viaKeyboard.getHTML());
    expect(viaSoftKeyboard.state.doc.textContent).toBe("Previous lineOuterInner");
  });

  it("leaves a selected run of text alone, then removes the emptied wrapper on the next boundary deletion", () => {
    const editor = makeEditorWith(BASE_CONTENT);
    selectText(editor, "Task text");

    const softDelete = dispatchBeforeinput(editor);
    expect(softDelete.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toContain('data-type="taskItem"');
    expect(editor.state.doc.textContent).toBe("Previous lineTask text");

    // Desktop deletes just the selected text and keeps the empty task.
    dispatchBackspace(editor);
    expect(editor.getHTML()).toContain('data-type="taskItem"');
    expect(editor.state.doc.textContent).toBe("Previous line");

    // The next deletion at the emptied boundary removes the wrapper.
    cursorAtTaskItem(editor, 0);
    const boundaryDelete = dispatchBeforeinput(editor);
    expect(boundaryDelete.defaultPrevented).toBe(true);
    expect(editor.getHTML()).not.toContain('data-type="taskItem"');
    expect(editor.state.doc.textContent).toBe("Previous line");
  });

  it("passes mid-text soft deletion through to the browser", () => {
    const editor = makeEditorWith(BASE_CONTENT);
    cursorInText(editor, "Task text", 4);
    const before = editor.getHTML();

    const event = dispatchBeforeinput(editor);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("passes soft deletion in a plain paragraph through to the browser", () => {
    const editor = makeEditorWith(BASE_CONTENT);
    cursorInText(editor, "Previous line", 0);
    const before = editor.getHTML();

    const event = dispatchBeforeinput(editor);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("passes soft deletion at the start of a later paragraph through to the browser", () => {
    const editor = makeEditorWith(TWO_PARAGRAPH_CONTENT);
    cursorInText(editor, "Two", 0);
    const before = editor.getHTML();

    const event = dispatchBeforeinput(editor);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("cannot change a noneditable editor through beforeinput", () => {
    const editor = makeEditor();
    const before = editor.getHTML();
    editor.setEditable(false);

    const event = dispatchBeforeinput(editor);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(before);
    expect(editor.getHTML()).toContain('data-type="taskItem"');
  });
  it("ignores forward deletion and non-deletion input types", () => {
    for (const inputType of ["deleteContentForward", "insertText"]) {
      const editor = makeEditor();
      const before = editor.getHTML();
      const event = dispatchBeforeinput(editor, { inputType });
      expect(event.defaultPrevented).toBe(false);
      expect(editor.getHTML()).toBe(before);
    }
  });

  it("ignores noncancelable deletion events", () => {
    const editor = makeEditor();
    const before = editor.getHTML();
    const event = dispatchBeforeinput(editor, { cancelable: false });
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getHTML()).toBe(before);
  });

  it("ignores deletion while composing", () => {
    const composingEvent = makeEditor();
    const beforeComposing = composingEvent.getHTML();
    const event = dispatchBeforeinput(composingEvent, { isComposing: true });
    expect(event.defaultPrevented).toBe(false);
    expect(composingEvent.getHTML()).toBe(beforeComposing);

    const viewComposing = makeEditor();
    const beforeView = viewComposing.getHTML();
    // `composing` is a prototype getter on EditorView, so shadow it per
    // instance instead of assigning.
    Object.defineProperty(viewComposing.view, "composing", {
      value: true,
      configurable: true,
    });
    try {
      const viewEvent = dispatchBeforeinput(viewComposing);
      expect(viewEvent.defaultPrevented).toBe(false);
      expect(viewComposing.getHTML()).toBe(beforeView);
    } finally {
      delete (viewComposing.view as unknown as Record<string, unknown>).composing;
    }
  });
});
