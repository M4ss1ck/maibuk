import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkClickHandler } from "../../../../components/editor/LinkClickHandler";

const { mockNavigate } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../../../features/chapters/store", () => ({
  useChapterStore: (selector: (state: { chapters: unknown[] }) => unknown) =>
    selector({ chapters: [] }),
}));

vi.mock("../../../../lib/platform", () => ({
  openExternal: vi.fn(),
}));

describe("LinkClickHandler", () => {
  it("uses the async book resolver when a chapter link is not in the chapter store", async () => {
    const dom = document.createElement("div");
    const resolveBookIdForChapter = vi.fn(async () => "book-1");
    const editor = {
      view: { dom },
      chain: () => ({
        focus: () => ({
          unsetLink: () => ({ run: vi.fn() }),
        }),
      }),
    } as unknown as import("@tiptap/react").Editor;

    render(<LinkClickHandler editor={editor} resolveBookIdForChapter={resolveBookIdForChapter} />);

    const link = document.createElement("a");
    link.className = "editor-link";
    link.href = "maibuk://chapter/chapter-1";
    dom.appendChild(link);

    fireEvent.click(link);

    await waitFor(() => expect(resolveBookIdForChapter).toHaveBeenCalledWith("chapter-1"));
    expect(mockNavigate).toHaveBeenCalledWith("/book/book-1", {
      state: {
        openChapterId: "chapter-1",
        scrollToHeadingId: undefined,
      },
    });
  });
});
