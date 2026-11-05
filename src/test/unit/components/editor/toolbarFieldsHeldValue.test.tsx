import { Editor } from "@tiptap/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FontFamilySelect } from "@/components/editor/FontFamilySelect";
import { FontSizeSelect } from "@/components/editor/FontSizeSelect";
import { LineHeightSelect } from "@/components/editor/LineHeightSelect";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Issue #724: the Editor Toolbar renders these fields without `shouldFocusEditor`,
// which leaves the shared Combobox re-committing the value it already holds on
// blur, Escape and Enter. Each test counts the transactions that change the doc,
// so a write of the held value is caught even when the HTML would end up equal.

const HELD_SIZE = "18";
const UNTOUCHED = "<p>Hello world</p>";

const editors: Editor[] = [];
const containers: HTMLElement[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
  }
  for (const container of containers.splice(0)) {
    container.remove();
  }
});

interface Harness {
  editor: Editor;
  // Transactions dispatched since the harness was made that changed the doc.
  docTransactions: () => number;
}

// A real editor over "Hello world" with "Hello" selected, as the Editor Toolbar sees it.
function makeHarness(): Harness {
  const element = document.createElement("div");
  const editor = new Editor({
    element,
    extensions: createRichTextExtensions(),
    content: UNTOUCHED,
  });
  editors.push(editor);
  editor.commands.setTextSelection({ from: 1, to: 6 });

  let count = 0;
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) count++;
  });

  return { editor, docTransactions: () => count };
}

// Puts the editor's DOM after the rendered field, so Tab out of the field reaches
// the sibling button first and focus assertions can see the text.
function mountEditor(editor: Editor) {
  const element = editor.options.element as HTMLElement;
  document.body.appendChild(element);
  containers.push(element);
}

// Renders a field the way the Editor Toolbar does, with a focusable sibling to Tab to.
function renderField(field: ReactNode, editor: Editor) {
  const view = render(
    <>
      {field}
      <button type="button">after</button>
    </>
  );
  mountEditor(editor);
  return view;
}

function html(editor: Editor): string {
  return editor.getHTML().replace(/;"/g, '"');
}

function field(): HTMLElement {
  return screen.getByRole("combobox");
}

async function focusField() {
  const user = userEvent.setup();
  await user.tab();
  expect(field()).toHaveFocus();
  return user;
}

describe("FontSizeSelect rendered by the Editor Toolbar", () => {
  it("writes nothing when Tab only passes through the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.tab();

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("writes nothing when Escape leaves the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.keyboard("{Escape}");

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("writes nothing when the list is open and Tab leaves the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.tab();

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("writes nothing when a half-typed value leaves by Tab", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.keyboard("{Control>}a{/Control}2");
    expect(field()).toHaveValue("2");

    await user.tab();

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("discards typing on Escape and leaves the held value in the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.keyboard("{Control>}a{/Control}2");
    expect(field()).toHaveValue("2");

    await user.keyboard("{Escape}");

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue(HELD_SIZE);
  });

  it("applies a typed value on Enter in one transaction", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    await user.keyboard("{Control>}a{/Control}24{Enter}");

    expect(docTransactions()).toBe(1);
    expect(html(editor)).toContain('<span style="font-size: 24px">Hello</span>');
  });

  it("applies a value picked from the list and puts focus in the text", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    // Down opens the list on the held 18; Down again picks the next size up.
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

    expect(docTransactions()).toBe(1);
    expect(html(editor)).toContain("font-size: 20px");
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    // The commit pulls focus into the text, after React Aria settles the pick.
    await waitFor(() => {
      const active = document.activeElement;
      expect(active === editor.view.dom || editor.view.dom.contains(active)).toBe(true);
    });
  });

  it("writes nothing when the list picks the value the field already shows", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontSizeSelect editor={editor} value={HELD_SIZE} />, editor);

    const user = await focusField();
    // Down opens the list on the held 18; Enter picks it, which changes nothing.
    await user.keyboard("{ArrowDown}{Enter}");

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });
});

describe("FontFamilySelect rendered by the Editor Toolbar", () => {
  it("writes nothing when the list is open and Tab leaves the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontFamilySelect editor={editor} value="Literata, serif" />, editor);

    const user = await focusField();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.tab();

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("discards a typed value on Escape", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<FontFamilySelect editor={editor} value="Literata, serif" />, editor);

    const user = await focusField();
    await user.keyboard("{Control>}a{/Control}Georgia, serif");
    expect(field()).toHaveValue("Georgia, serif");

    await user.keyboard("{Escape}");

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
    expect(field()).toHaveValue("Literata, serif");
  });
});

describe("LineHeightSelect rendered by the Editor Toolbar", () => {
  it("writes nothing when the list is open and Tab leaves the field", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<LineHeightSelect editor={editor} value="1.75" />, editor);

    const user = await focusField();
    await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("listbox")).toBeInTheDocument();

    await user.tab();

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
  });

  it("discards a typed value on Escape", async () => {
    const { editor, docTransactions } = makeHarness();
    renderField(<LineHeightSelect editor={editor} value="1.75" />, editor);

    const user = await focusField();
    await user.keyboard("{Control>}a{/Control}1.5");
    expect(field()).toHaveValue("1.5");

    await user.keyboard("{Escape}");

    expect(docTransactions()).toBe(0);
    expect(html(editor)).toBe(UNTOUCHED);
    expect(field()).toHaveValue("1.75");
  });
});
