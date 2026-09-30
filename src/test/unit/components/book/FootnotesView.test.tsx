import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectFootnotes, Footnote } from "@/components/editor/extensions/Footnote";
import { FootnotesView } from "@/components/editor/FootnotesView";
import { useModalStore } from "@/components/ui/modal-store";
import type { Chapter } from "@/features/chapters/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${Object.values(options).join(" ")}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The side panel changes Footnotes through the editor's commands; the editor's
// own node view is not on screen here.
const HeadlessFootnote = Footnote.extend({ addNodeView: () => null });

const fn = (id: string, content: string) =>
  `<sup data-footnote="" data-footnote-id="${id}" data-footnote-content="${content}">*</sup>`;

function buildChapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: overrides.id ?? "c1",
    bookId: overrides.bookId ?? "book-1",
    title: overrides.title ?? "Chapter One",
    content: overrides.content ?? "",
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    chapterType: overrides.chapterType ?? "chapter",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-01-01T00:00:00Z"),
  } as Chapter;
}

const editors: Editor[] = [];
function makeEditor(content: string) {
  const editor = new Editor({ extensions: [StarterKit, HeadlessFootnote], content });
  editors.push(editor);
  return editor;
}
const texts = (editor: Editor) => collectFootnotes(editor.state.doc).map((f) => f.content);

const one = buildChapter({
  id: "c1",
  title: "Chapter One",
  order: 0,
  content: `<p>A${fn("a", "Saved first")}</p>`,
});
const two = buildChapter({
  id: "c2",
  title: "Chapter Two",
  order: 1,
  content: `<p>B${fn("b", "Other chapter")} C${fn("c", "Another")}</p>`,
});
const three = buildChapter({ id: "c3", title: "Chapter Three", order: 2, content: "<p>none</p>" });

const grid = () => screen.getByRole("grid", { name: "bookSidePanel.footnotes" });
const row = (text: string) => within(grid()).getByRole("row", { name: new RegExp(text) });

async function focusRow(user: ReturnType<typeof userEvent.setup>, text: string) {
  const target = row(text);
  if (!grid().contains(document.activeElement)) await user.tab();
  for (let i = 0; i < 6 && document.activeElement !== target; i++)
    await user.keyboard("{ArrowDown}");
  expect(target).toHaveFocus();
  return target;
}

async function runFromMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await screen.findByRole("menu");
  const item = screen.getByRole("menuitem", { name });
  for (let i = 0; i < 4 && document.activeElement !== item; i++) await user.keyboard("{ArrowDown}");
  await user.keyboard("{Enter}");
}

async function saveEdit(user: ReturnType<typeof userEvent.setup>, text: string) {
  const dialog = await screen.findByRole("dialog", { name: "editor.editFootnote" });
  const field = within(dialog).getByRole("textbox");
  await waitFor(() => expect(field).toHaveFocus());
  await user.clear(field);
  await user.keyboard(text);
  await user.tab();
  await user.tab();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("FootnotesView", () => {
  it("shows the empty message when there are no footnotes", () => {
    render(
      <FootnotesView
        chapters={[buildChapter({ content: "<p>plain</p>" })]}
        currentChapterId={null}
        onSelectChapter={vi.fn()}
      />
    );

    expect(screen.getByText("editor.noFootnotes")).toBeInTheDocument();
  });

  it("lists footnote content grouped under its chapter title, numbered across the Book", () => {
    render(
      <FootnotesView chapters={[two, one, three]} currentChapterId="c1" onSelectChapter={vi.fn()} />
    );

    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    expect(screen.queryByText("Chapter Three")).not.toBeInTheDocument();
    expect(row("Saved first")).toHaveTextContent("1.Saved first");
    expect(row("Other chapter")).toHaveTextContent("2.Other chapter");
    expect(row("Another")).toHaveTextContent("3.Another");
  });

  it("reads stored Footnotes whatever the order of their attributes", () => {
    const chapter = buildChapter({
      content:
        '<p>A<sup data-footnote-content="Content first" data-footnote-id="x" data-footnote="">*</sup>' +
        'B<sup data-footnote="" data-footnote-id="y" data-footnote-content="Id &amp; first">*</sup></p>',
    });

    render(
      <FootnotesView chapters={[chapter]} currentChapterId={null} onSelectChapter={vi.fn()} />
    );

    expect(row("Content first")).toHaveTextContent("1.Content first");
    expect(row("Id & first")).toHaveTextContent("2.Id & first");
  });

  it("reads the open Chapter's Footnotes from its editor, not the saved text", () => {
    const editor = makeEditor(`<p>A${fn("a", "Typed just now")}</p>`);

    render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={vi.fn()}
        editor={editor}
      />
    );

    expect(row("Typed just now")).toHaveTextContent("1.Typed just now");
    expect(screen.queryByText("Saved first")).not.toBeInTheDocument();
  });

  it("edits an open Chapter's Footnote through its editor and shows the new text at once", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(`<p>A${fn("a", "Saved first")}</p>`);
    const onSelectChapter = vi.fn();
    render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={onSelectChapter}
        editor={editor}
      />
    );

    const entry = await focusRow(user, "Saved first");
    await runFromMenu(user, "editor.editFootnote");
    await saveEdit(user, "Rewritten");

    expect(texts(editor)).toEqual(["Rewritten"]);
    expect(row("Rewritten")).toHaveTextContent("1.Rewritten");
    expect(onSelectChapter).not.toHaveBeenCalled();
    await waitFor(() => expect(entry).toHaveFocus());
  });

  it("deletes an open Chapter's Footnote and moves focus to the next entry", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(`<p>A${fn("a", "Saved first")}</p>`);
    render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={vi.fn()}
        editor={editor}
      />
    );

    await focusRow(user, "Saved first");
    await runFromMenu(user, "editor.deleteFootnote");

    await waitFor(() => expect(texts(editor)).toEqual([]));
    expect(screen.queryByText("Chapter One")).not.toBeInTheDocument();
    expect(row("Other chapter")).toHaveTextContent("1.Other chapter");
    await waitFor(() => expect(row("Other chapter")).toHaveFocus());
  });

  it("opens another Chapter to edit its Footnote, then changes it in that Chapter's editor", async () => {
    const user = userEvent.setup();
    const openEditor = makeEditor(`<p>A${fn("a", "Saved first")}</p>`);
    const onSelectChapter = vi.fn();
    const { rerender } = render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={onSelectChapter}
        editor={openEditor}
      />
    );

    await focusRow(user, "Another");
    await runFromMenu(user, "editor.editFootnote");
    await saveEdit(user, "Changed elsewhere");

    expect(onSelectChapter).toHaveBeenCalledWith(two);
    expect(texts(openEditor)).toEqual(["Saved first"]);

    // The Book Editor switches Chapter; the old editor is still passed for a render.
    rerender(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c2"
        onSelectChapter={onSelectChapter}
        editor={openEditor}
      />
    );
    // The new editor mounts before its text loads.
    const chapterTwoEditor = makeEditor("<p></p>");
    rerender(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c2"
        onSelectChapter={onSelectChapter}
        editor={chapterTwoEditor}
      />
    );
    expect(texts(chapterTwoEditor)).toEqual([]);

    act(() => {
      chapterTwoEditor.commands.setContent(two.content ?? "", { emitUpdate: true });
    });

    expect(texts(chapterTwoEditor)).toEqual(["Other chapter", "Changed elsewhere"]);
    expect(texts(openEditor)).toEqual(["Saved first"]);
    expect(row("Changed elsewhere")).toHaveTextContent("3.Changed elsewhere");
  });

  it("deletes another Chapter's Footnote once that Chapter is open", async () => {
    const user = userEvent.setup();
    const onSelectChapter = vi.fn();
    const { rerender } = render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={onSelectChapter}
      />
    );

    await focusRow(user, "Other chapter");
    await runFromMenu(user, "editor.deleteFootnote");
    expect(onSelectChapter).toHaveBeenCalledWith(two);

    const chapterTwoEditor = makeEditor(two.content ?? "");
    rerender(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c2"
        onSelectChapter={onSelectChapter}
        editor={chapterTwoEditor}
      />
    );

    expect(texts(chapterTwoEditor)).toEqual(["Another"]);
    await waitFor(() => expect(screen.queryByText("Other chapter")).not.toBeInTheDocument());
  });

  it("drops a pending change when the author opens yet another Chapter first", async () => {
    const user = userEvent.setup();
    const onSelectChapter = vi.fn();
    const { rerender } = render(
      <FootnotesView
        chapters={[one, two, three]}
        currentChapterId="c1"
        onSelectChapter={onSelectChapter}
      />
    );
    await focusRow(user, "Other chapter");
    await runFromMenu(user, "editor.deleteFootnote");

    // The target Chapter opens, but its text has not loaded when the author moves on.
    const loading = makeEditor("<p></p>");
    rerender(
      <FootnotesView
        chapters={[one, two, three]}
        currentChapterId="c2"
        onSelectChapter={onSelectChapter}
        editor={loading}
      />
    );
    rerender(
      <FootnotesView
        chapters={[one, two, three]}
        currentChapterId="c3"
        onSelectChapter={onSelectChapter}
      />
    );
    const later = makeEditor(two.content ?? "");
    rerender(
      <FootnotesView
        chapters={[one, two, three]}
        currentChapterId="c2"
        onSelectChapter={onSelectChapter}
        editor={later}
      />
    );

    expect(texts(later)).toEqual(["Other chapter", "Another"]);
  });

  it("calls onEmptied when a Delete removes the Book's last Footnote", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(`<p>A${fn("a", "Saved first")}</p>`);
    const onEmptied = vi.fn();
    render(
      <FootnotesView
        chapters={[one]}
        currentChapterId="c1"
        onSelectChapter={vi.fn()}
        editor={editor}
        onEmptied={onEmptied}
      />
    );

    await focusRow(user, "Saved first");
    await runFromMenu(user, "editor.deleteFootnote");

    await waitFor(() => expect(screen.getByText("editor.noFootnotes")).toBeInTheDocument());
    expect(onEmptied).toHaveBeenCalledTimes(1);
  });

  it("Escape in the Edit dialog changes nothing and returns focus to the entry", async () => {
    const user = userEvent.setup();
    const editor = makeEditor(`<p>A${fn("a", "Saved first")}</p>`);
    render(
      <FootnotesView
        chapters={[one, two]}
        currentChapterId="c1"
        onSelectChapter={vi.fn()}
        editor={editor}
      />
    );

    const entry = await focusRow(user, "Saved first");
    await runFromMenu(user, "editor.editFootnote");
    await screen.findByRole("dialog", { name: "editor.editFootnote" });
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(texts(editor)).toEqual(["Saved first"]);
    await waitFor(() => expect(entry).toHaveFocus());
  });
});
