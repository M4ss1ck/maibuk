import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FootnotesView } from "../../../../components/editor/FootnotesView";
import type { Chapter } from "../../../../features/chapters/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

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

describe("FootnotesView", () => {
  it("shows the empty message when there are no footnotes", () => {
    render(
      <FootnotesView
        chapters={[buildChapter({ content: "<p>plain</p>" })]}
        currentChapterId={null}
        onSelectChapter={vi.fn()}
      />,
    );

    expect(screen.getByText("editor.noFootnotes")).toBeInTheDocument();
  });

  it("lists footnote content grouped under its chapter title", () => {
    const chapter = buildChapter({
      id: "c1",
      title: "Chapter One",
      content:
        '<p>Text<sup data-footnote-content="My note" data-footnote-id="f1">1</sup></p>',
    });

    render(
      <FootnotesView
        chapters={[chapter]}
        currentChapterId="c1"
        onSelectChapter={vi.fn()}
      />,
    );

    expect(screen.getByText("My note")).toBeInTheDocument();
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
  });
});
