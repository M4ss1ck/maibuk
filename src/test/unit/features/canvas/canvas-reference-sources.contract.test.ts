import { StickyNote } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBookStore } from "@/features/books/store";
import type { Book } from "@/features/books/types";
import { type Note, useNoteStore } from "@/features/notes";
import {
  CANVAS_REFERENCE_SOURCES,
  type CanvasReferenceOpenContext,
  type CanvasReferenceResolution,
  type CanvasReferenceSource,
  getCanvasReferenceSource,
} from "@/features/canvas/references";
import { bookReferenceSource } from "@/features/canvas/bookReferenceSource";
import { chapterReferenceSource } from "@/features/canvas/chapterReferenceSource";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";

/**
 * Every source has to answer the same way: filter its rows by the query, answer
 * present and missing ids, and open only what it can find. A new source joins
 * CANVAS_REFERENCE_SOURCES and adds its fixture here, or the registry test fails.
 */

// The Chapter source reads its rows and its targets from the Chapters store, so
// the two reads are faked here; the store that stays live is the real one.
const { mockListChapterTitles, mockGetChaptersByIds } = vi.hoisted(() => ({
  mockListChapterTitles: vi.fn(),
  mockGetChaptersByIds: vi.fn(),
}));

vi.mock("@/features/chapters/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/chapters/store")>();
  return {
    ...actual,
    listChapterTitles: mockListChapterTitles,
    getChaptersByIds: mockGetChaptersByIds,
  };
});

function noteRow(id: string, title: string, order: number): Note {
  return {
    id,
    title,
    content: "",
    language: "en",
    tags: [],
    pinned: false,
    order,
    wordCount: 0,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
  };
}

function bookRow(id: string, title: string): Book {
  return {
    id,
    title,
    authorName: "Ada",
    language: "en",
    wordCount: 0,
    status: "draft",
    createdAt: new Date(1),
    updatedAt: new Date(1),
    contentUpdatedAt: new Date(1),
  };
}

function chapterRow(id: string, bookId: string, title: string) {
  return { id, bookId, title, content: "<p>Body</p>", updatedAt: new Date(1000) };
}

interface HostSourceFixture {
  /** The id `query` matches, and the only row `list(query)` returns. */
  presentId: string;
  /** A row that exists but the query does not match. */
  otherId: string;
  /** An id no source holds. */
  missingId: string;
  query: string;
  /** The route a present id opens. */
  path: string;
  /** The route a present id opens, when it is not `${path}/${id}`. */
  openTo?(presentId: string): string;
  seed(): void;
}

const HOST_SOURCE_FIXTURES: Record<string, HostSourceFixture> = {
  book: {
    presentId: "book-alpha",
    otherId: "book-beta",
    missingId: "book-gone",
    query: "alpha",
    path: "/book",
    seed() {
      useBookStore.setState({
        books: [bookRow("book-alpha", "Alpha harbor"), bookRow("book-beta", "Beta")],
        error: null,
        loadBooks: vi.fn().mockResolvedValue(undefined),
      });
    },
  },
  chapter: {
    presentId: "chapter-alpha",
    otherId: "chapter-beta",
    missingId: "chapter-gone",
    query: "alpha",
    // A Chapter opens at its Book, which is not the Chapter's own id.
    path: "/book",
    openTo: (presentId) => `/book/book-of-${presentId}`,
    seed() {
      useBookStore.setState({
        books: [
          bookRow("book-of-chapter-alpha", "Alpha harbor"),
          bookRow("book-of-chapter-beta", "Beta"),
        ],
        error: null,
        loadBooks: vi.fn().mockResolvedValue(undefined),
      });
      const chapters = [
        chapterRow("chapter-alpha", "book-of-chapter-alpha", "Alpha harbor"),
        chapterRow("chapter-beta", "book-of-chapter-beta", "Beta"),
      ];
      mockListChapterTitles.mockResolvedValue(
        chapters.map(({ id, bookId, title }) => ({ id, bookId, title }))
      );
      mockGetChaptersByIds.mockImplementation(async (ids: readonly string[]) =>
        chapters.filter((chapter) => ids.includes(chapter.id))
      );
    },
  },
  note: {
    presentId: "note-alpha",
    otherId: "note-beta",
    missingId: "note-gone",
    query: "alpha",
    path: "/notes",
    seed() {
      useNoteStore.setState({
        notes: [noteRow("note-alpha", "Alpha harbor", 2), noteRow("note-beta", "Beta", 1)],
        loadNotes: vi.fn().mockResolvedValue(undefined),
      });
    },
  },
};

const fakeRows = [
  { id: "fake-alpha", title: "Alpha harbor" },
  { id: "fake-beta", title: "Beta" },
];

const fakeSource: CanvasReferenceSource = {
  id: "fake",
  label: "canvas.referenceSources.fake",
  icon: StickyNote,
  card: "note",
  async list(query) {
    const needle = query.trim().toLocaleLowerCase();
    return fakeRows.filter((row) => row.title.toLocaleLowerCase().includes(needle));
  },
  async resolve(ids) {
    const answers: Record<string, CanvasReferenceResolution> = {};
    for (const id of ids) {
      const row = fakeRows.find((candidate) => candidate.id === id);
      answers[id] = row
        ? { status: "present", title: row.title, value: row }
        : { status: "missing" };
    }
    return answers;
  },
  async open(id) {
    return fakeRows.some((row) => row.id === id) ? "opened" : "missing";
  },
};

function hostFixtureFor(id: string): HostSourceFixture {
  const fixture = HOST_SOURCE_FIXTURES[id];
  if (!fixture) throw new Error(`No contract fixture for Canvas Reference source "${id}"`);
  return fixture;
}

interface ContractCase {
  name: string;
  source: CanvasReferenceSource;
  presentId: string;
  otherId: string;
  missingId: string;
  query: string;
  /** The route a present id opens; only read when the source navigates. */
  path: string;
  /** The route a present id opens, when it is not `${path}/${presentId}`. */
  openTo?: string;
  seed?(): void;
  /** Host sources navigate in-app; a fake may resolve without leaving. */
  callsNavigate: boolean;
}

const contractCases: ContractCase[] = [
  ...CANVAS_REFERENCE_SOURCES.map((source) => {
    const fixture = hostFixtureFor(source.id);
    return {
      name: source.id,
      source,
      presentId: fixture.presentId,
      otherId: fixture.otherId,
      missingId: fixture.missingId,
      query: fixture.query,
      path: fixture.path,
      openTo: fixture.openTo?.(fixture.presentId),
      seed: () => fixture.seed(),
      callsNavigate: true,
    };
  }),
  {
    name: "fake",
    source: fakeSource,
    presentId: "fake-alpha",
    otherId: "fake-beta",
    missingId: "fake-gone",
    query: "alpha",
    path: "",
    callsNavigate: false,
  },
];

const openContext = (
  navigate: CanvasReferenceOpenContext["navigate"]
): CanvasReferenceOpenContext => ({
  canvasId: "canvas-1",
  canvasTitle: "My canvas",
  navigate,
});

/** Records the Router calls a host source makes when it opens an id. */
function spyNavigate() {
  const calls: Array<{ to: string; options: unknown }> = [];
  // NavigateFunction is overloaded (a path, or a history delta); recording the
  // arguments needs one signature over both.
  const navigate = ((to: unknown, options?: unknown) => {
    calls.push({ to: String(to), options });
  }) as CanvasReferenceOpenContext["navigate"];
  return { navigate, calls };
}

describe("canvas reference sources registry", () => {
  it("has a contract fixture for every registered source", () => {
    expect(Object.keys(HOST_SOURCE_FIXTURES).sort()).toEqual(
      CANVAS_REFERENCE_SOURCES.map((source) => source.id).sort()
    );
  });

  it("registers the Book and Chapter sources beside the Note source", () => {
    expect(CANVAS_REFERENCE_SOURCES.map((source) => source.id).sort()).toEqual([
      "book",
      "chapter",
      "note",
    ]);
    expect(getCanvasReferenceSource("book")).toBe(bookReferenceSource);
    expect(getCanvasReferenceSource("chapter")).toBe(chapterReferenceSource);
    expect(getCanvasReferenceSource("note")).toBe(noteReferenceSource);
    expect(getCanvasReferenceSource("unknown")).toBeUndefined();
  });
});

describe("the real Book source", () => {
  it("opens a present Book at its own route", async () => {
    HOST_SOURCE_FIXTURES.book.seed();
    const { navigate, calls } = spyNavigate();

    const result = await bookReferenceSource.open("book-alpha", openContext(navigate));

    expect(result).toBe("opened");
    expect(calls).toEqual([
      {
        to: "/book/book-alpha",
        options: { state: { returnTo: "/canvas/canvas-1", returnLabel: "My canvas" } },
      },
    ]);
  });
});

describe("the real Chapter source", () => {
  it("opens a present Chapter at its Book, asking for the Chapter", async () => {
    HOST_SOURCE_FIXTURES.chapter.seed();
    const { navigate, calls } = spyNavigate();

    const result = await chapterReferenceSource.open("chapter-alpha", openContext(navigate));

    expect(result).toBe("opened");
    expect(calls).toEqual([
      {
        to: "/book/book-of-chapter-alpha",
        options: {
          state: {
            openChapterId: "chapter-alpha",
            returnTo: "/canvas/canvas-1",
            returnLabel: "My canvas",
          },
        },
      },
    ]);
  });
});

describe.each(contractCases)("canvas reference source: $name", (testCase) => {
  beforeEach(() => {
    testCase.seed?.();
  });

  it("lists only the rows matching the query", async () => {
    const rows = await testCase.source.list(testCase.query, { canvasId: "canvas-1" });
    expect(rows.map((row) => row.id)).toEqual([testCase.presentId]);
  });

  it("lists every row for an empty query", async () => {
    const rows = await testCase.source.list("", { canvasId: "canvas-1" });
    expect(rows.map((row) => row.id).sort()).toEqual([testCase.presentId, testCase.otherId].sort());
  });

  it("answers the present id and the missing id", async () => {
    const answers = await testCase.source.resolve([testCase.presentId, testCase.missingId]);
    expect(answers[testCase.presentId]?.status).toBe("present");
    expect(answers[testCase.missingId]?.status).toBe("missing");
  });

  it("opens a present id", async () => {
    const { navigate, calls } = spyNavigate();
    const result = await testCase.source.open(testCase.presentId, openContext(navigate));
    expect(result).toBe("opened");
    if (testCase.callsNavigate) {
      // A card may carry more state than the way back (the Chapter card names
      // the Chapter to open); every source still says where it came from.
      expect(calls).toEqual([
        {
          to: testCase.openTo ?? `${testCase.path}/${testCase.presentId}`,
          options: {
            state: expect.objectContaining({
              returnTo: "/canvas/canvas-1",
              returnLabel: "My canvas",
            }),
          },
        },
      ]);
    } else {
      expect(calls).toEqual([]);
    }
  });

  it("refuses a missing id without navigating", async () => {
    const { navigate, calls } = spyNavigate();
    const result = await testCase.source.open(testCase.missingId, openContext(navigate));
    expect(result).toBe("missing");
    expect(calls).toEqual([]);
  });
});
