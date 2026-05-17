import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VersionCompare } from "../../../../components/versions/VersionCompare";
import type { BookSnapshot } from "../../../../features/sync/types";
import type { BookDiff } from "../../../../features/versions/compare";

const { mockDiffSnapshots } = vi.hoisted(() => ({
  mockDiffSnapshots: vi.fn(),
}));

vi.mock("../../../../features/versions/compare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../features/versions/compare")>();
  return {
    ...actual,
    diffSnapshots: mockDiffSnapshots,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "versions.chapterAdded": "This chapter only exists in the version being compared",
        "versions.chapterRemoved": "This chapter is not in the version being compared",
        "versions.compareUnavailable":
          "Compare unavailable for this chapter — showing the saved version only",
        "versions.hideChapterList": "Hide chapter list",
        "versions.noChanges": "No changes",
        "versions.showChapterList": "Show chapter list",
        "versions.status.added": "Added",
        "versions.status.modified": "Modified",
        "versions.status.removed": "Removed",
        "versions.status.unchanged": "Unchanged",
      };
      return map[key] ?? key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const snapshot = {
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
    wordCount: 0,
    targetWordCount: null,
    status: "draft",
    createdAt: 1,
    updatedAt: 1,
    lastOpenedAt: null,
    lastChapterId: null,
  },
  chapters: [],
} satisfies BookSnapshot;

function renderCompare(diff: BookDiff) {
  mockDiffSnapshots.mockReturnValue(diff);
  return render(<VersionCompare current={snapshot} target={snapshot} />);
}

describe("VersionCompare", () => {
  it("renders the no-changes placeholder for unchanged chapters", () => {
    renderCompare({
      chapters: [{ chapterId: "chapter-1", title: "Chapter 1", status: "unchanged", html: null }],
    });

    expect(screen.getByText("No changes")).toBeInTheDocument();
  });

  it("renders an added banner with chapter HTML", () => {
    renderCompare({
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Chapter 1",
          status: "added",
          html: "<p>New chapter</p>",
        },
      ],
    });

    expect(
      screen.getByText("This chapter only exists in the version being compared")
    ).toBeInTheDocument();
    expect(screen.getByText("New chapter")).toBeInTheDocument();
  });

  it("renders a removed banner with chapter HTML", () => {
    renderCompare({
      chapters: [
        {
          chapterId: "chapter-2",
          title: "Chapter 2",
          status: "removed",
          html: "<p>Removed chapter</p>",
        },
      ],
    });

    expect(screen.getByText("This chapter is not in the version being compared")).toBeInTheDocument();
    expect(screen.getByText("Removed chapter")).toBeInTheDocument();
  });

  it("renders a fallback notice when diffing was unavailable", () => {
    renderCompare({
      chapters: [
        {
          chapterId: "chapter-1",
          title: "Chapter 1",
          status: "modified",
          html: "<p>Saved version</p>",
          fallback: true,
        },
      ],
    });

    expect(
      screen.getByText("Compare unavailable for this chapter — showing the saved version only")
    ).toBeInTheDocument();
    expect(screen.getByText("Saved version")).toBeInTheDocument();
  });

  it("can collapse and restore the chapter list", async () => {
    const user = userEvent.setup();
    renderCompare({
      chapters: [
        { chapterId: "chapter-1", title: "Chapter 1", status: "unchanged", html: null },
        { chapterId: "chapter-2", title: "Chapter 2", status: "modified", html: "<p>Edit</p>" },
      ],
    });

    expect(screen.getByRole("button", { name: /Chapter 2/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide chapter list" }));

    expect(screen.queryByRole("button", { name: /Chapter 2/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show chapter list" }));

    expect(screen.getByRole("button", { name: /Chapter 2/ })).toBeInTheDocument();
  });
});
