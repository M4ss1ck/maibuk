import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { TableMenu } from "@/components/editor/TableMenu";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const editors: Editor[] = [];

function createEditor(content: string): Editor {
  const editor = new Editor({ extensions: createRichTextExtensions(), content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

const TABLE_HTML =
  "<p>outside</p>" +
  "<table><tbody>" +
  "<tr><td>cell one</td><td>cell two</td></tr>" +
  "<tr><td>cell three</td><td>cell four</td></tr>" +
  "</tbody></table>" +
  "<p>after</p>";

/** Position just inside the first textblock containing the needle. */
function textPos(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent.includes(needle)) {
      found = pos + 1;
    }
  });
  if (found < 0) throw new Error(`text not found: ${needle}`);
  return found;
}

function countNodes(editor: Editor, name: string): number {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) count += 1;
  });
  return count;
}

function expectOutsideTable() {
  expect(screen.getByLabelText("editor.insertTable")).toBeEnabled();
  expect(screen.getByLabelText("editor.addColumnBefore")).toBeDisabled();
  expect(screen.getByLabelText("editor.addColumnAfter")).toBeDisabled();
  expect(screen.getByLabelText("editor.addRowBefore")).toBeDisabled();
  expect(screen.getByLabelText("editor.addRowAfter")).toBeDisabled();
  expect(screen.getByLabelText("editor.deleteColumn")).toBeDisabled();
  expect(screen.getByLabelText("editor.deleteRow")).toBeDisabled();
  expect(screen.getByLabelText("editor.deleteTable")).toBeDisabled();
}

function expectInsideTable() {
  expect(screen.getByLabelText("editor.insertTable")).toBeDisabled();
  expect(screen.getByLabelText("editor.addColumnBefore")).toBeEnabled();
  expect(screen.getByLabelText("editor.addColumnAfter")).toBeEnabled();
  expect(screen.getByLabelText("editor.addRowBefore")).toBeEnabled();
  expect(screen.getByLabelText("editor.addRowAfter")).toBeEnabled();
  expect(screen.getByLabelText("editor.deleteColumn")).toBeEnabled();
  expect(screen.getByLabelText("editor.deleteRow")).toBeEnabled();
  expect(screen.getByLabelText("editor.deleteTable")).toBeEnabled();
}

describe("TableMenu", () => {
  it("keeps every control mounted outside a table, with edit actions disabled", () => {
    const editor = createEditor("<p>outside</p>");
    render(<TableMenu editor={editor} />);
    expectOutsideTable();
  });

  it("disables insert and enables edit actions inside a table", () => {
    const editor = createEditor(TABLE_HTML);
    act(() => {
      editor.commands.setTextSelection(textPos(editor, "cell one"));
    });
    render(<TableMenu editor={editor} />);
    expectInsideTable();
  });

  it("updates controls when the selection moves into and out of a table without a parent rerender", () => {
    const editor = createEditor(TABLE_HTML);
    render(<TableMenu editor={editor} />);
    expectOutsideTable();

    act(() => {
      editor.commands.setTextSelection(textPos(editor, "cell one"));
    });
    expectInsideTable();

    act(() => {
      editor.commands.setTextSelection(1);
    });
    expectOutsideTable();
  });

  it("inserts a table from the size picker via keyboard", async () => {
    const user = userEvent.setup();
    const editor = createEditor("<p>hello</p>");
    render(<TableMenu editor={editor} />);

    screen.getByLabelText("editor.insertTable").focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("table-size-2-3")).toBeInTheDocument();

    screen.getByTestId("table-size-2-3").focus();
    await user.keyboard("{Enter}");

    expect(screen.queryByTestId("table-size-2-3")).not.toBeInTheDocument();
    expect(editor.getHTML()).toContain("<table");
    expect(countNodes(editor, "tableRow")).toBe(2);
    expect(countNodes(editor, "tableHeader") + countNodes(editor, "tableCell")).toBe(6);
    expectInsideTable();
  });

  it("adds a column and a row via keyboard with document assertions", async () => {
    const user = userEvent.setup();
    const editor = createEditor(TABLE_HTML);
    render(<TableMenu editor={editor} />);
    act(() => {
      editor.commands.setTextSelection(textPos(editor, "cell one"));
    });
    const cellsBefore = countNodes(editor, "tableCell");
    const rowsBefore = countNodes(editor, "tableRow");

    screen.getByLabelText("editor.addColumnAfter").focus();
    await user.keyboard("{Enter}");
    expect(countNodes(editor, "tableCell")).toBe(cellsBefore + rowsBefore);

    screen.getByLabelText("editor.addRowAfter").focus();
    // NB: user-event has no `{Space}` descriptor; a literal " " presses Space.
    await user.keyboard(" ");
    expect(countNodes(editor, "tableRow")).toBe(rowsBefore + 1);
  });

  it("deletes the table via keyboard", async () => {
    const user = userEvent.setup();
    const editor = createEditor(TABLE_HTML);
    render(<TableMenu editor={editor} />);
    act(() => {
      editor.commands.setTextSelection(textPos(editor, "cell one"));
    });
    expectInsideTable();

    screen.getByLabelText("editor.deleteTable").focus();
    await user.keyboard("{Enter}");

    expect(editor.getHTML()).not.toContain("<table");
    expectOutsideTable();
  });

  it("closes the size picker on Escape and restores focus to the insert button", async () => {
    const user = userEvent.setup();
    const editor = createEditor("<p>outside</p>");
    render(<TableMenu editor={editor} />);

    const insertButton = screen.getByLabelText("editor.insertTable");
    await user.click(insertButton);
    expect(screen.getByTestId("table-size-5-5")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByTestId("table-size-5-5")).not.toBeInTheDocument();
    expect(insertButton).toHaveFocus();
  });

  it("stops Escape propagation so an outer window Escape handler is not invoked", async () => {
    const user = userEvent.setup();
    const outerEscapeSpy = vi.fn();
    window.addEventListener("keydown", outerEscapeSpy);
    try {
      const editor = createEditor("<p>outside</p>");
      render(<TableMenu editor={editor} />);

      await user.click(screen.getByLabelText("editor.insertTable"));
      expect(screen.getByTestId("table-size-5-5")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(screen.queryByTestId("table-size-5-5")).not.toBeInTheDocument();
      expect(outerEscapeSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", outerEscapeSpy);
    }
  });
});
