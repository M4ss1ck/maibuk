// src/test/unit/features/links/navigate.test.ts
import { describe, expect, it, vi } from "vitest";
import { navigateToLinkTarget } from "../../../../features/links/navigate";

describe("navigateToLinkTarget", () => {
  it("routes a note URI to the note editor", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("maibuk://note/n1", navigate);
    expect(navigate).toHaveBeenCalledWith("/notes/n1");
  });

  it("routes a heading URI to the book editor with chapter+heading state", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("maibuk://heading/c1/h-2", navigate, {
      bookIdForChapter: () => "b1",
    });
    expect(navigate).toHaveBeenCalledWith("/book/b1", {
      state: { openChapterId: "c1", scrollToHeadingId: "h-2" },
    });
  });

  it("routes a note-heading URI to the note editor with heading state", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("maibuk://note-heading/n1/h-research", navigate);
    expect(navigate).toHaveBeenCalledWith("/notes/n1", {
      state: { scrollToHeadingId: "h-research" },
    });
  });

  it("routes a chapter URI to the book editor", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("maibuk://chapter/c1", navigate, {
      bookIdForChapter: () => "b9",
    });
    expect(navigate).toHaveBeenCalledWith("/book/b9", {
      state: { openChapterId: "c1", scrollToHeadingId: undefined },
    });
  });

  it("routes a book URI to the book editor root", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("maibuk://book/b1", navigate);
    expect(navigate).toHaveBeenCalledWith("/book/b1", { state: {} });
  });

  it("ignores non-internal hrefs", () => {
    const navigate = vi.fn();
    navigateToLinkTarget("https://example.com", navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});
