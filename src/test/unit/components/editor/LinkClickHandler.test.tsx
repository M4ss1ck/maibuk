import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { LinkClickHandler } from "@/components/editor/LinkClickHandler";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { createTestDatabase } from "../../../support/db-test-context";
import type { DatabaseAdapter } from "@/lib/platform/types";

let testDb: DatabaseAdapter;
const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));
const { mockGetDatabase } = vi.hoisted(() => ({ mockGetDatabase: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDatabase: mockGetDatabase }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../../lib/platform", () => ({
  openExternal: vi.fn(),
}));

describe("LinkClickHandler", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);
    const now = Math.floor(Date.now() / 1000);
    await testDb.execute(
      `INSERT INTO books (id, title, author_name, created_at, updated_at) VALUES ('book-1','Book','Author',?,?)`,
      [now, now]
    );
    await testDb.execute(
      `INSERT INTO chapters (id, book_id, title, content, "order", created_at, updated_at) VALUES ('chapter-1','book-1','Ch','<p>hi</p>',0,?,?)`,
      [now, now]
    );
    mockNavigate.mockClear();
  });

  it("uses the book id from DB for a chapter link", async () => {
    const dom = document.createElement("div");
    const editor = {
      view: { dom },
      chain: () => ({
        focus: () => ({
          unsetLink: () => ({ run: vi.fn() }),
        }),
      }),
    } as unknown as import("@tiptap/react").Editor;

    render(<LinkClickHandler editor={editor} />);

    const link = document.createElement("a");
    link.className = "editor-link";
    link.href = "maibuk://chapter/chapter-1";
    dom.appendChild(link);

    fireEvent.click(link);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1", {
      state: {
        openChapterId: "chapter-1",
      },
    });
  });

  describe("Mod+Enter follows the Link at the caret", () => {
    const editors: Editor[] = [];

    afterEach(() => {
      for (const editor of editors.splice(0)) editor.destroy();
    });

    function renderWithLink(href: string) {
      const editor = new Editor({
        extensions: createRichTextExtensions(),
        content: `<p><a href="${href}">Target</a></p>`,
      });
      editors.push(editor);
      render(
        <>
          <EditorContent editor={editor} />
          <LinkClickHandler editor={editor} />
        </>
      );
      editor.commands.setTextSelection(2);
      editor.view.dom.focus();
      return editor;
    }

    it("navigates to an internal target", async () => {
      const user = userEvent.setup();
      renderWithLink("maibuk://chapter/chapter-1");

      await user.keyboard("{Control>}{Enter}{/Control}");

      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith("/book/book-1", {
          state: { openChapterId: "chapter-1" },
        })
      );
    });

    it("asks before opening an external link", async () => {
      const user = userEvent.setup();
      renderWithLink("https://example.com/read");

      await user.keyboard("{Control>}{Enter}{/Control}");

      expect(screen.getByRole("dialog", { name: "editor.openLink" })).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it("falls back when the Link target no longer exists", async () => {
      const user = userEvent.setup();
      await testDb.execute("DELETE FROM chapters WHERE id = 'chapter-1'");
      renderWithLink("maibuk://chapter/chapter-1");

      await user.keyboard("{Control>}{Enter}{/Control}");

      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", undefined));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
