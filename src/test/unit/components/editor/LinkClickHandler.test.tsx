import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { LinkClickHandler } from "@/components/editor/LinkClickHandler";
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
});
