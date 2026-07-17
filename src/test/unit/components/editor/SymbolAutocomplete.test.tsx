import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import {
  SymbolAutocomplete,
  SYMBOL_AUTOCOMPLETE_LIMIT,
} from "@/components/editor/extensions/SymbolAutocomplete";
import { createSymbolSuggestionRenderer } from "@/components/editor/SymbolSuggestion";
import type { SymbolEntry } from "@/features/symbols/types";

const editors: Editor[] = [];

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

document.elementFromPoint ??= () => null;

function entry(index: number): SymbolEntry {
  return {
    glyph: String.fromCodePoint(0x1f600 + index),
    label: `smile ${index}`,
    code: null,
    category: "Smileys & Emotion",
    search: `smile ${index}`,
  };
}

function renderEditor(items: SymbolEntry[]) {
  const extensions = createRichTextExtensions().map((extension) =>
    extension.name === "symbolAutocomplete"
      ? SymbolAutocomplete.configure({
          items: ({ query }) => (query ? items : []),
          render: createSymbolSuggestionRenderer(),
        })
      : extension
  );
  const editor = new Editor({
    extensions,
  });
  editors.push(editor);
  render(
    <StrictMode>
      <EditorContent editor={editor} />
    </StrictMode>
  );
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("SymbolAutocomplete", () => {
  it("selects a real catalog result with Enter in the canonical editor", async () => {
    const user = userEvent.setup();
    const editor = new Editor({ extensions: createRichTextExtensions() });
    editors.push(editor);
    render(
      <StrictMode>
        <EditorContent editor={editor} />
      </StrictMode>
    );

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":smile");
    const listbox = await screen.findByRole("listbox", { name: "Symbols" });
    const firstGlyph = within(listbox).getAllByRole("option")[0].textContent;
    await user.keyboard("{Enter}");

    expect(editor.getText()).not.toContain(":smile");
    expect(firstGlyph).toContain(editor.getText());
  });

  it("shows at most ten results and selects the highlighted result with the arrow keys and Enter", async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 12 }, (_, index) => entry(index));
    const editor = renderEditor(items);

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":smile");

    const listbox = await screen.findByRole("listbox", { name: "Symbols" });
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(SYMBOL_AUTOCOMPLETE_LIMIT);

    await user.keyboard("{ArrowDown}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowUp}");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(editor.getText()).toBe(items[1].glyph);
    expect(screen.queryByRole("listbox", { name: "Symbols" })).not.toBeInTheDocument();
  });

  it("selects the first result with Tab", async () => {
    const user = userEvent.setup();
    const items = [entry(0), entry(1)];
    const editor = renderEditor(items);

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":smile");
    await screen.findByRole("listbox", { name: "Symbols" });
    await user.keyboard("{Tab}");

    expect(editor.getText()).toBe(items[0].glyph);
  });

  it("selects a specific result with a click", async () => {
    const user = userEvent.setup();
    const items = [entry(0), entry(1), entry(2)];
    const editor = renderEditor(items);

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":smile");
    const listbox = await screen.findByRole("listbox", { name: "Symbols" });
    await user.click(within(listbox).getByRole("option", { name: /smile 2/i }));

    expect(editor.getText()).toBe(items[2].glyph);
  });

  it("does not request items for a bare colon", async () => {
    const user = userEvent.setup();
    const items = vi.fn(() => [entry(0)]);
    const extensions = createRichTextExtensions().map((extension) =>
      extension.name === "symbolAutocomplete"
        ? SymbolAutocomplete.configure({ items, render: createSymbolSuggestionRenderer() })
        : extension
    );
    const editor = new Editor({
      extensions,
    });
    editors.push(editor);
    render(
      <StrictMode>
        <EditorContent editor={editor} />
      </StrictMode>
    );

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":");

    expect(items).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox", { name: "Symbols" })).not.toBeInTheDocument();
  });

  it("closes the suggestions with Escape without changing the typed text", async () => {
    const user = userEvent.setup();
    const editor = renderEditor([entry(0)]);

    await user.click(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), ":smile");
    await screen.findByRole("listbox", { name: "Symbols" });
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox", { name: "Symbols" })).not.toBeInTheDocument();
    expect(editor.getText()).toBe(":smile");
  });
});
