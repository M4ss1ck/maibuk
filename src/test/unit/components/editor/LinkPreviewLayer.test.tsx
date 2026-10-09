import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { LinkPreviewLayer } from "@/components/editor/LinkPreviewLayer";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { Wikilink } from "@/components/editor/extensions/Wikilink";
import { clearLinkPreviewCache } from "@/features/links/link-preview";
import type { DatabaseAdapter } from "@/lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

let testDb: DatabaseAdapter;
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join("|")})` : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const editors: Editor[] = [];
const LONG_TEXT = Array.from({ length: 80 }, (_, n) => `word${n}`).join(" ");

beforeEach(async () => {
  clearLinkPreviewCache();
  testDb = await createTestDatabase();
  mockGetDatabase.mockResolvedValue(testDb);
  const now = Math.floor(Date.now() / 1000);
  await testDb.execute(
    `INSERT INTO books (id, title, author_name, description, created_at, updated_at)
     VALUES ('b1', 'The Long Road', 'Ana Ruiz', 'A journey north.', ?, ?)`,
    [now, now]
  );
  await testDb.execute(
    `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at)
     VALUES ('c1', 'b1', 'Departure', '<p>They left at <strong>dawn</strong>.</p>', 0, ?, ?)`,
    [now, now]
  );
  await testDb.execute(
    `INSERT INTO notes (id, title, content, "order", created_at, updated_at)
     VALUES ('n1', 'Ideas', ?, 0, ?, ?)`,
    [`<p>${LONG_TEXT}</p>`, now, now]
  );
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** "Before " then the Link text, then " after." Positions: Link spans 8..14. */
function renderEditor(href: string) {
  const editor = new Editor({
    extensions: createRichTextExtensions(),
    content: `<p>Before <a href="${href}">Target</a> after.</p>`,
  });
  editors.push(editor);
  render(
    <>
      <EditorContent editor={editor} />
      <LinkPreviewLayer editor={editor} />
    </>
  );
  editor.commands.setTextSelection(1);
  editor.view.dom.focus();
  return editor;
}

async function caretIntoLink(user: ReturnType<typeof userEvent.setup>) {
  for (let i = 0; i < 9; i++) await user.keyboard("{ArrowRight}");
}

describe("Link Preview", () => {
  describe("from the caret", () => {
    it("shows a Chapter Link's target once the caret rests in it", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");

      await caretIntoLink(user);
      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();

      const preview = await screen.findByRole("tooltip", { name: "linkPreview.label" });
      expect(within(preview).getByText("The Long Road")).toBeInTheDocument();
      expect(within(preview).getByText("Departure")).toBeInTheDocument();
      expect(within(preview).getByText("dawn").tagName).toBe("STRONG");
    });

    it("tells a screen reader where the Link goes", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");

      await caretIntoLink(user);

      await waitFor(() =>
        expect(screen.getByTestId("link-preview-announcer")).toHaveTextContent(
          "linkPreview.announce(editor.linkTargetChapter|The Long Road › Departure|They left at dawn.)"
        )
      );
    });

    it("stays hidden while the caret is outside every Link", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");

      await user.keyboard("{ArrowRight}");
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
    });

    it("hides when the caret leaves the Link", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");
      await caretIntoLink(user);
      await screen.findByRole("tooltip", { name: "linkPreview.label" });

      await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");

      await waitFor(() =>
        expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument()
      );
    });

    it("hides on typing and comes back once the caret moves again", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");
      await caretIntoLink(user);
      await screen.findByRole("tooltip", { name: "linkPreview.label" });

      await user.keyboard("x");
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();

      await user.keyboard("{ArrowLeft}");
      expect(await screen.findByRole("tooltip", { name: "linkPreview.label" })).toBeInTheDocument();
    });

    it("hides on Escape and keeps the caret in the editor", async () => {
      const user = userEvent.setup();
      const editor = renderEditor("maibuk://chapter/c1");
      await caretIntoLink(user);
      await screen.findByRole("tooltip", { name: "linkPreview.label" });
      const onEscape = vi.fn();
      document.addEventListener("keydown", onEscape);

      await user.keyboard("{Escape}");
      document.removeEventListener("keydown", onEscape);

      expect(onEscape).not.toHaveBeenCalled();
      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
      expect(document.activeElement).toBe(editor.view.dom);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
    });
  });

  describe("on a wikilink", () => {
    function renderWikilinkEditor() {
      const editor = new Editor({
        extensions: [...createRichTextExtensions(), Wikilink],
        // A wikilink just inserted through [[ is its own node until the Note
        // reloads (stored, it parses back as a Link mark).
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "See " },
                { type: "wikilink", attrs: { href: "maibuk://chapter/c1", label: "Departure" } },
                { type: "text", text: " now." },
              ],
            },
          ],
        },
      });
      expect(editor.state.doc.firstChild?.child(1).type.name).toBe("wikilink");
      editors.push(editor);
      render(
        <>
          <EditorContent editor={editor} />
          <LinkPreviewLayer editor={editor} />
        </>
      );
      editor.commands.setTextSelection(1);
      editor.view.dom.focus();
      return editor;
    }

    it("shows the target once arrows select the wikilink", async () => {
      const user = userEvent.setup();
      renderWikilinkEditor();

      for (let i = 0; i < 5; i++) await user.keyboard("{ArrowRight}");

      expect(await screen.findByRole("tooltip", { name: "linkPreview.label" })).toHaveTextContent(
        "They left at dawn."
      );
    });

    it("shows the target while a mouse rests on the wikilink", async () => {
      const user = userEvent.setup();
      renderWikilinkEditor();

      await user.hover(screen.getByText("Departure"));

      expect(await screen.findByRole("tooltip", { name: "linkPreview.label" })).toHaveTextContent(
        "They left at dawn."
      );
    });
  });

  it("leaves Escape to the rest of the app before the preview shows", async () => {
    const user = userEvent.setup();
    renderEditor("maibuk://chapter/c1");
    await caretIntoLink(user);
    const onEscape = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    document.addEventListener("keydown", onEscape);

    await user.keyboard("{Escape}");
    document.removeEventListener("keydown", onEscape);

    expect(onEscape).toHaveReturnedWith(false);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
  });

  describe("from the pointer", () => {
    it("shows the target while a mouse rests on the Link", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");

      await user.hover(screen.getByText("Target"));
      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
      expect(await screen.findByRole("tooltip", { name: "linkPreview.label" })).toHaveTextContent(
        "Departure"
      );

      await user.unhover(screen.getByText("Target"));
      await waitFor(() =>
        expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument()
      );
    });

    it("never opens from a touch", async () => {
      const user = userEvent.setup();
      renderEditor("maibuk://chapter/c1");

      await user.pointer({ keys: "[TouchA]", target: screen.getByText("Target") });
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(screen.queryByRole("tooltip", { name: "linkPreview.label" })).not.toBeInTheDocument();
    });
  });

  describe("content", () => {
    async function previewOf(href: string) {
      const user = userEvent.setup();
      renderEditor(href);
      await caretIntoLink(user);
      return screen.findByRole("tooltip", { name: "linkPreview.label" });
    }

    it("fades a cut-off text", async () => {
      const preview = await previewOf("maibuk://note/n1");
      await within(preview).findByText(/word0/);
      expect(within(preview).getByTestId("link-preview-snippet")).toHaveAttribute(
        "data-truncated",
        "true"
      );
    });

    it("does not fade a text shown whole", async () => {
      const preview = await previewOf("maibuk://chapter/c1");
      await within(preview).findByText("dawn");
      expect(within(preview).getByTestId("link-preview-snippet")).toHaveAttribute(
        "data-truncated",
        "false"
      );
    });

    it("shows a Book's author and description", async () => {
      const preview = await previewOf("maibuk://book/b1");
      expect(await within(preview).findByText("The Long Road")).toBeInTheDocument();
      expect(within(preview).getByText("linkPreview.byAuthor(Ana Ruiz)")).toBeInTheDocument();
      expect(within(preview).getByText("A journey north.")).toBeInTheDocument();
    });

    it("shows a web address with its domain first", async () => {
      const preview = await previewOf("https://example.com/guide");
      expect(within(preview).getByText("example.com")).toBeInTheDocument();
      expect(preview).toHaveTextContent("https://example.com/guide");
    });

    it("says when the target no longer exists", async () => {
      const preview = await previewOf("maibuk://note/gone");
      expect(await within(preview).findByText("deepLink.resourceGone")).toBeInTheDocument();
    });

    it("keeps the breadcrumb when the heading is gone", async () => {
      const preview = await previewOf("maibuk://heading/c1/h-gone");
      expect(await within(preview).findByText("deepLink.headingGone")).toBeInTheDocument();
      expect(within(preview).getByText("Departure")).toBeInTheDocument();
    });
  });
});
