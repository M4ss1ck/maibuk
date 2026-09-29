import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectFootnotes, Footnote } from "@/components/editor/extensions/Footnote";
import { FootnoteList } from "@/components/editor/FootnoteList";
import { useModalStore } from "@/components/ui/modal-store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

const fn = (id: string, content: string) =>
  `<sup data-footnote="" data-footnote-id="${id}" data-footnote-content="${content}">*</sup>`;

const THREE = `<p>One${fn("a", "First")} two${fn("b", "Second")} three${fn("c", "Third")}</p>`;

let editorRef: Editor | null = null;

function Harness({ content, startIndex = 1 }: { content: string; startIndex?: number }) {
  const editor = useEditor({ extensions: [StarterKit, Footnote], content });
  editorRef = editor;
  if (!editor) return null;
  return (
    <>
      <EditorContent editor={editor} />
      <FootnoteList editor={editor} startIndex={startIndex} />
    </>
  );
}

const texts = () => collectFootnotes(editorRef!.state.doc).map((f) => f.content);
const grid = () => screen.getByRole("grid", { name: "bookSidePanel.footnotes" });
const row = (text: string) => within(grid()).getByRole("row", { name: new RegExp(text) });

async function renderList(content = THREE, startIndex?: number) {
  const user = userEvent.setup();
  render(<Harness content={content} startIndex={startIndex} />);
  await screen.findByRole("grid", { name: "bookSidePanel.footnotes" });
  return user;
}

/** Tabs into the grid (it is one Tab stop) and arrows down to the entry. */
async function focusRow(user: ReturnType<typeof userEvent.setup>, text: string) {
  const target = row(text);
  // The editor text comes first in Tab order.
  for (let i = 0; i < 5 && !grid().contains(document.activeElement); i++) await user.tab();
  for (let i = 0; i < 5 && document.activeElement !== target; i++)
    await user.keyboard("{ArrowDown}");
  expect(target).toHaveFocus();
  return target;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Shift>}{F10}{/Shift}");
  return screen.findByRole("menu");
}

/** Arrows to a menu item and presses Enter, as React Aria focuses the menu first. */
async function chooseMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  const item = screen.getByRole("menuitem", { name });
  for (let i = 0; i < 4 && document.activeElement !== item; i++) await user.keyboard("{ArrowDown}");
  expect(item).toHaveFocus();
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  editorRef = null;
  useModalStore.setState({ modalIds: [], openCount: 0 });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

describe("FootnoteList", () => {
  it("numbers the entries from the Chapter's start index", async () => {
    await renderList(THREE, 4);

    const rows = within(grid()).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("4.First"),
      expect.stringContaining("5.Second"),
      expect.stringContaining("6.Third"),
    ]);
  });

  it("moves between entries with the arrow keys", async () => {
    const user = await renderList();

    await focusRow(user, "First");
    await user.keyboard("{ArrowDown}");
    expect(row("Second")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(row("First")).toHaveFocus();
  });

  it("edits a Footnote from its Item Menu, keeping its id and number", async () => {
    const user = await renderList();
    const entry = await focusRow(user, "Second");

    const menu = await openMenu(user);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual(["editor.editFootnote", "editor.deleteFootnote"]);
    await chooseMenuItem(user, "editor.editFootnote");

    const dialog = await screen.findByRole("dialog", { name: "editor.editFootnote" });
    const field = within(dialog).getByRole("textbox", { name: "editor.footnoteContent" });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue("Second");

    await user.clear(field);
    await user.keyboard("Rewritten");
    await user.tab();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "common.save" })).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(texts()).toEqual(["First", "Rewritten", "Third"]);
    expect(collectFootnotes(editorRef!.state.doc).map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(editorRef!.getHTML()).toContain('data-footnote-content="Rewritten"');
    expect(row("Rewritten")).toHaveTextContent("2.Rewritten");
    await waitFor(() => expect(entry.isConnected ? entry : row("Rewritten")).toHaveFocus());
  });

  it("Escape in the Edit dialog changes nothing and returns focus to the entry", async () => {
    const user = await renderList();
    const entry = await focusRow(user, "Second");
    await openMenu(user);
    await chooseMenuItem(user, "editor.editFootnote");
    const dialog = await screen.findByRole("dialog", { name: "editor.editFootnote" });
    await user.clear(within(dialog).getByRole("textbox"));
    await user.keyboard("Draft");
    expect(within(dialog).getByRole("textbox")).toHaveValue("Draft");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(texts()).toEqual(["First", "Second", "Third"]);
    await waitFor(() => expect(entry).toHaveFocus());
  });

  it("refuses to save an empty Footnote", async () => {
    const user = await renderList();
    await focusRow(user, "First");
    await openMenu(user);
    await chooseMenuItem(user, "editor.editFootnote");
    const dialog = await screen.findByRole("dialog", { name: "editor.editFootnote" });
    await user.clear(within(dialog).getByRole("textbox"));
    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");

    expect(within(dialog).getByText("editor.footnoteRequired")).toBeInTheDocument();
    expect(texts()).toEqual(["First", "Second", "Third"]);
  });

  it("deletes a Footnote from its Item Menu, renumbers the rest, and focuses the next entry", async () => {
    const user = await renderList();
    await focusRow(user, "Second");
    await openMenu(user);
    await chooseMenuItem(user, "editor.deleteFootnote");

    await waitFor(() => expect(texts()).toEqual(["First", "Third"]));
    expect(editorRef!.getText()).toBe("One two three");
    expect(row("Third")).toHaveTextContent("2.Third");
    await waitFor(() => expect(row("Third")).toHaveFocus());
  });

  it("restores a deleted Footnote with its text on one undo", async () => {
    const user = await renderList();
    await focusRow(user, "Second");
    await openMenu(user);
    await chooseMenuItem(user, "editor.deleteFootnote");
    await waitFor(() => expect(texts()).toEqual(["First", "Third"]));

    act(() => editorRef!.view.focus());
    expect(editorRef!.view.dom).toHaveFocus();
    await user.keyboard("{Control>}z{/Control}");

    await waitFor(() => expect(texts()).toEqual(["First", "Second", "Third"]));
    expect(row("Second")).toHaveTextContent("2.Second");
  });

  it("hands focus to the text when the last Footnote is deleted", async () => {
    const user = await renderList(`<p>Only${fn("a", "Lonely")}</p>`);
    await focusRow(user, "Lonely");
    await openMenu(user);
    await chooseMenuItem(user, "editor.deleteFootnote");

    await waitFor(() =>
      expect(screen.queryByRole("grid", { name: "bookSidePanel.footnotes" })).toBeNull()
    );
    await waitFor(() => expect(editorRef!.view.dom).toHaveFocus());
  });

  it("runs Edit and Delete from their Commands' Shortcuts while an entry has focus", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        ...structuredClone(DEFAULT_SHORTCUT_SETTINGS),
        custom: {
          "footnoteItem.edit": [["Mod+Shift+e"]],
          "footnoteItem.delete": [["Mod+Shift+x"]],
        },
      },
    });
    const user = await renderList();
    await focusRow(user, "First");

    await user.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");
    await waitFor(() => expect(texts()).toEqual(["Second", "Third"]));

    await waitFor(() => expect(row("Second")).toHaveFocus());
    await user.keyboard("{Control>}{Shift>}e{/Shift}{/Control}");
    expect(await screen.findByRole("dialog", { name: "editor.editFootnote" })).toBeInTheDocument();
  });

  it("does not run the Commands while focus is in the text", async () => {
    useShortcutSettingsStore.setState({
      shortcuts: {
        ...structuredClone(DEFAULT_SHORTCUT_SETTINGS),
        custom: { "footnoteItem.delete": [["Mod+Shift+x"]] },
      },
    });
    const user = await renderList();
    act(() => editorRef!.view.focus());
    expect(editorRef!.view.dom).toHaveFocus();

    await user.keyboard("{Control>}{Shift>}x{/Shift}{/Control}");

    expect(texts()).toEqual(["First", "Second", "Third"]);
  });

  it("offers the same actions on the hover buttons for pointer devices", async () => {
    const user = await renderList();
    await focusRow(user, "Third");
    await user.tab();
    expect(within(row("Third")).getByRole("button", { name: "editor.editFootnote" })).toHaveFocus();
    await user.tab();
    const remove = within(row("Third")).getByRole("button", { name: "editor.deleteFootnote" });
    expect(remove).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(texts()).toEqual(["First", "Second"]));
  });
});
