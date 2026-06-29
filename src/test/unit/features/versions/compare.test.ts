import { describe, expect, it, vi } from "vitest";
import type { BookSnapshot } from "@/features/sync/types";

function chapter(
  id: string,
  title: string,
  content: string | null,
  order: number
): BookSnapshot["chapters"][number] {
  return {
    id,
    bookId: "book-1",
    title,
    content,
    synopsis: null,
    order,
    parentId: null,
    chapterType: "chapter",
    wordCount: 10,
    status: "draft",
    isIncludedInExport: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(chapters: BookSnapshot["chapters"]): BookSnapshot {
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
      wordCount: 10,
      targetWordCount: null,
      status: "draft",
      createdAt: 1,
      updatedAt: 1,
      lastOpenedAt: null,
      lastChapterId: null,
    },
    chapters,
  };
}

describe("diffSnapshots()", () => {
  it("marks every chapter unchanged when contents match", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([
      chapter("chapter-1", "One", "<p>Same</p>", 0),
      chapter("chapter-2", "Two", "<p>Also same</p>", 1),
    ]);
    const target = snapshot([
      chapter("chapter-1", "One", "<p>Same</p>", 0),
      chapter("chapter-2", "Two", "<p>Also same</p>", 1),
    ]);

    expect(diffSnapshots(current, target)).toEqual({
      chapters: [
        { chapterId: "chapter-1", title: "One", status: "unchanged", html: null },
        { chapterId: "chapter-2", title: "Two", status: "unchanged", html: null },
      ],
    });
  });

  it("marks a reworded paragraph modified with insertion and deletion markup", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([chapter("chapter-1", "One", "<p>The dark night</p>", 0)]);
    const target = snapshot([chapter("chapter-1", "One", "<p>The stormy night</p>", 0)]);

    const [diff] = diffSnapshots(current, target).chapters;

    expect(diff.status).toBe("modified");
    expect(diff.html).toContain("<del");
    expect(diff.html).toContain("<ins");
    expect(diff.html).toContain("dark");
    expect(diff.html).toContain("stormy");
  });

  it("preserves inline formatting around unchanged text", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([
      chapter("chapter-1", "One", "<p><strong>Bold</strong> and <em>quiet</em></p>", 0),
    ]);
    const target = snapshot([
      chapter("chapter-1", "One", "<p><strong>Bold</strong> and <em>loud</em></p>", 0),
    ]);

    const [diff] = diffSnapshots(current, target).chapters;

    expect(diff.html).toContain("<strong>Bold</strong>");
    expect(diff.html).toContain("<em>");
  });

  it("marks a target-only chapter added with sanitized target HTML", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([]);
    const target = snapshot([
      chapter("chapter-1", "New", '<p>New chapter</p><img src="x" onerror="alert(1)">', 0),
    ]);

    const [diff] = diffSnapshots(current, target).chapters;

    expect(diff).toEqual({
      chapterId: "chapter-1",
      title: "New",
      status: "added",
      html: '<p>New chapter</p><img src="x">',
    });
  });

  it("appends removed chapters after target-side chapters", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([
      chapter("chapter-1", "Removed", "<p>Gone</p>", 0),
      chapter("chapter-2", "Kept", "<p>Kept old</p>", 1),
    ]);
    const target = snapshot([chapter("chapter-2", "Kept", "<p>Kept new</p>", 0)]);

    const diff = diffSnapshots(current, target);

    expect(diff.chapters.map((item) => item.chapterId)).toEqual(["chapter-2", "chapter-1"]);
    expect(diff.chapters[1]).toEqual({
      chapterId: "chapter-1",
      title: "Removed",
      status: "removed",
      html: "<p>Gone</p>",
    });
  });

  it("strips unsafe HTML while preserving diff tags", async () => {
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([chapter("chapter-1", "One", "<p>Old text</p>", 0)]);
    const target = snapshot([
      chapter("chapter-1", "One", '<p>New text</p><script>alert("x")</script>', 0),
    ]);

    const [diff] = diffSnapshots(current, target).chapters;

    expect(diff.html).toContain("<ins");
    expect(diff.html).toContain("<del");
    expect(diff.html).not.toContain("<script");
  });

  it("falls back to sanitized target HTML when html diffing throws", async () => {
    vi.resetModules();
    vi.doMock("node-htmldiff", () => ({
      default: () => {
        throw new Error("diff failed");
      },
    }));
    const { diffSnapshots } = await import("@/features/versions/compare");
    const current = snapshot([chapter("chapter-1", "One", "<p>Old</p>", 0)]);
    const target = snapshot([
      chapter("chapter-1", "One", '<p>New</p><script>alert("x")</script>', 0),
    ]);

    const [diff] = diffSnapshots(current, target).chapters;

    expect(diff).toEqual({
      chapterId: "chapter-1",
      title: "One",
      status: "modified",
      html: "<p>New</p>",
      fallback: true,
    });

    vi.doUnmock("node-htmldiff");
    vi.resetModules();
  });
});
