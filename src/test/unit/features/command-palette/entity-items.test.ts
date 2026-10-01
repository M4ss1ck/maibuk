import { describe, expect, it } from "vitest";
import { buildEntityItems, buildPageItems } from "@/features/command-palette/entity-items";
import type { Book } from "@/features/books/types";
import type { Canvas } from "@/features/canvas/types";
import type { ChapterTitle } from "@/features/chapters/store";
import type { Note } from "@/features/notes/types";

const t = (key: string) => {
  const labels: Record<string, string> = {
    "notes.untitled": "Untitled note",
    "canvas.untitled": "Untitled canvas",
    "commandPalette.pages.chapters": "Open Chapter…",
    "commandPalette.pages.books": "Go to Book…",
    "commandPalette.pages.notes": "Open Note…",
    "commandPalette.pages.canvases": "Open Canvas…",
  };
  if (key in labels) return labels[key];
  return key;
};

function buildBook(id: string, title: string): Book {
  return {
    id,
    title,
    status: "draft",
    createdAt: 0,
    updatedAt: 0,
  } as unknown as Book;
}

function buildNote(id: string, title: string, bookId: string | null): Note {
  return { id, title, bookId } as unknown as Note;
}

function buildCanvas(id: string, title: string): Canvas {
  return { id, title } as unknown as Canvas;
}

function chapter(id: string, bookId: string, title: string): ChapterTitle {
  return { id, bookId, title };
}

describe("buildEntityItems()", () => {
  it("keys each entity by kind and id and marks them runnable", () => {
    const items = buildEntityItems({
      books: [buildBook("b1", "The Sea")],
      chapters: [chapter("c1", "b1", "Arrival")],
      notes: [buildNote("n1", "Idea", null)],
      canvases: [buildCanvas("v1", "Map")],
      t,
    });

    expect(items.map((item) => item.key)).toEqual([
      "book:b1",
      "chapter:c1",
      "note:n1",
      "canvas:v1",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "The Sea",
      "Arrival",
      "Idea",
      "Map",
    ]);
    for (const item of items) {
      expect(item.state).toBe("runnable");
      expect(item.terms).toEqual([]);
    }
  });

  it("gives a Chapter its Book's title and id", () => {
    const items = buildEntityItems({
      books: [buildBook("b1", "The Sea"), buildBook("b2", "The Mountain")],
      chapters: [chapter("c1", "b2", "Climb")],
      notes: [],
      canvases: [],
      t,
    });

    const found = items.find((item) => item.key === "chapter:c1");
    expect(found?.detail).toBe("The Mountain");
    expect(found?.bookId).toBe("b2");
  });

  it("gives a Book Note its Book's title and leaves an Unfiled Note without one", () => {
    const items = buildEntityItems({
      books: [buildBook("b1", "The Sea")],
      chapters: [],
      notes: [buildNote("n1", "In the Book", "b1"), buildNote("n2", "Loose", null)],
      canvases: [],
      t,
    });

    expect(items.find((item) => item.key === "note:n1")?.detail).toBe("The Sea");
    expect(items.find((item) => item.key === "note:n2")?.detail).toBeUndefined();
  });

  it("leaves a Chapter's detail unset when its Book is not loaded", () => {
    const items = buildEntityItems({
      books: [],
      chapters: [chapter("c1", "missing", "Climb")],
      notes: [],
      canvases: [],
      t,
    });

    expect(items[0].detail).toBeUndefined();
    expect(items[0].bookId).toBe("missing");
  });

  it("falls back to the untitled label of a Note and a Canvas, and keeps a Book's raw title", () => {
    const items = buildEntityItems({
      books: [buildBook("b1", "")],
      chapters: [],
      notes: [buildNote("n1", "  ", null)],
      canvases: [buildCanvas("v1", "")],
      t,
    });

    expect(items.find((item) => item.kind === "note")?.label).toBe("Untitled note");
    expect(items.find((item) => item.kind === "canvas")?.label).toBe("Untitled canvas");
    // Books and Chapters have no untitled fallback in the app today.
    expect(items.find((item) => item.kind === "book")?.label).toBe("");
  });
});

describe("buildPageItems()", () => {
  it("offers Open Chapter… only in the Book Editor", () => {
    const inEditor = buildPageItems({ t, inBookEditor: true }).map((item) => item.targetPage);
    const elsewhere = buildPageItems({ t, inBookEditor: false }).map((item) => item.targetPage);

    expect(inEditor).toEqual(["chapters", "books", "notes", "canvases"]);
    expect(elsewhere).toEqual(["books", "notes", "canvases"]);
  });

  it("labels each page and carries its target", () => {
    const items = buildPageItems({ t, inBookEditor: false });

    expect(items.map((item) => item.key)).toEqual([
      "page:books",
      "page:notes",
      "page:canvases",
    ]);
    expect(items.map((item) => item.label)).toEqual([
      "Go to Book…",
      "Open Note…",
      "Open Canvas…",
    ]);
    expect(items.every((item) => item.kind === "page")).toBe(true);
    expect(items.every((item) => item.state === "runnable")).toBe(true);
    expect(items.every((item) => item.targetPage === item.id)).toBe(true);
  });
});