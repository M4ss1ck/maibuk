import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VersionPreview } from "@/components/versions/VersionPreview";
import type { BookSnapshot } from "@/features/sync/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.words": "words",
        "editor.noChapter": "No chapter",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

function buildSnapshot(content: string): BookSnapshot {
  return {
    book: {
      id: "book-1",
      title: "Draft",
      subtitle: null,
      authorName: "Author",
      description: null,
      genre: null,
      language: "en",
      coverImagePath: null,
      coverData: null,
      wordCount: 2,
      targetWordCount: null,
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters: [
      {
        id: "chapter-1",
        bookId: "book-1",
        title: "Chapter 1",
        content,
        synopsis: null,
        order: 0,
        parentId: null,
        chapterType: "chapter",
        wordCount: 2,
        status: "draft",
        isIncludedInExport: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

describe("VersionPreview", () => {
  it("sanitizes chapter snapshot HTML before rendering", () => {
    const snapshot = buildSnapshot(
      '<p><strong>Hello</strong> world</p><script>alert("x")</script><img src=x onerror="alert(1)">'
    );

    const { container } = render(<VersionPreview snapshot={snapshot} />);

    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(container.querySelector("strong")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
  });
});
