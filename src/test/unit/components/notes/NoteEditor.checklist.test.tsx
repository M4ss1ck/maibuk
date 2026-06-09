import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note } from "../../../../features/notes";
import type { Book } from "../../../../features/books/types";

const { mockEditor, mockNotes, mockBooks, mockListAllChaptersForLinking } = vi.hoisted(() => ({
  mockEditor: vi.fn((_: unknown) => <div />),
  mockListAllChaptersForLinking: vi.fn(() =>
    Promise.resolve([
      {
        id: "chapter-1",
        bookId: "book-1",
        title: "Opening Chapter",
        content: '<h2 id="h-opening">Opening Scene</h2><p>Body</p>',
      },
    ]),
  ),
  mockNotes: [
    {
      id: "note-1",
      title: "Current",
      content: "<p>Current body</p>",
      tags: [],
      pinned: false,
      order: 0,
      wordCount: 2,
      collapsedHeadings: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "note-2",
      title: "Research Note",
      content: '<h2 id="h-research">Research Question</h2><p>Research body</p>',
      tags: [],
      pinned: false,
      order: 1,
      wordCount: 2,
      collapsedHeadings: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ] satisfies Note[],
  mockBooks: [
    {
      id: "book-1",
      title: "Novel Draft",
      authorName: "Author",
      language: "en",
      wordCount: 100,
      status: "draft",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ] satisfies Book[],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.words": "words",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.collapseHeading": "Collapse heading",
        "notes.expandHeading": "Expand heading",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
        "notes.addTag": "Add tag",
        "notes.tags": "Tags",
      };
      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("../../../../lib/platform", () => ({
  IS_TAURI: false,
  createDatabase: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve({ rowsAffected: 0 })),
      select: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportData: vi.fn(() => Promise.resolve(new Uint8Array())),
      importData: vi.fn(() => Promise.resolve()),
    }),
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../components/editor", () => ({
  Editor: (props: { headerContent?: React.ReactNode }) => (
    <div>
      {props.headerContent}
      {mockEditor(props)}
    </div>
  ),
}));

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: (selector: (state: { notes: Note[] }) => unknown) => selector({ notes: mockNotes }),
}));

vi.mock("../../../../features/books/store", () => ({
  useBookStore: (selector?: (state: { books: Book[] }) => unknown) => {
    const state = { books: mockBooks };
    return selector ? selector(state) : state;
  },
}));

vi.mock("../../../../features/chapters/store", () => ({
  listAllChaptersForLinking: mockListAllChaptersForLinking,
  listChaptersForBookLinking: vi.fn(() =>
    Promise.resolve([
      {
        id: "chapter-1",
        bookId: "book-1",
        title: "Opening Chapter",
      },
    ]),
  ),
  getChapterForLinking: vi.fn(() =>
    Promise.resolve({
      id: "chapter-1",
      bookId: "book-1",
      title: "Opening Chapter",
      content: '<h2 id="h-opening">Opening Scene</h2><p>Body</p>',
    }),
  ),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "Initial",
    content: overrides.content ?? "<p>Initial body</p>",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 10,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor extensions", () => {
  beforeEach(() => {
    mockEditor.mockClear();
    mockListAllChaptersForLinking.mockClear();
  });

  it("passes task-list and collapsible-heading extensions to the shared Editor", () => {
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );

    const props = mockEditor.mock.calls[0]?.[0] as {
      extraExtensions?: unknown[];
    };

    expect(Array.isArray(props?.extraExtensions)).toBe(true);
    expect(props.extraExtensions).toHaveLength(5);

    const taskItemExtension = props.extraExtensions?.[1] as {
      options?: {
        nested?: boolean;
      };
      config?: {
        draggable?: boolean;
        addNodeView?: () => unknown;
      };
    };
    const taskDndBehavior = props.extraExtensions?.[2] as {
      config?: {
        addProseMirrorPlugins?: () => unknown;
      };
    };
    const collapsibleHeading = props.extraExtensions?.[3] as {
      options?: {
        collapseLabel?: string;
        expandLabel?: string;
      };
      config?: {
        addProseMirrorPlugins?: () => unknown;
      };
    };
    expect(taskItemExtension.options?.nested).toBe(true);
    expect(taskItemExtension.config?.draggable).toBe(true);
    expect(typeof taskItemExtension.config?.addNodeView).toBe("function");
    expect(typeof taskDndBehavior.config?.addProseMirrorPlugins).toBe("function");
    expect(collapsibleHeading.options).toMatchObject({
      collapseLabel: "Collapse heading",
      expandLabel: "Expand heading",
    });
    expect(typeof collapsibleHeading.config?.addProseMirrorPlugins).toBe("function");
  });

  it("passes notes and books as internal link targets to the shared Editor", () => {
    render(
      <NoteEditor
        note={buildNote({ id: "note-1" })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );

    const props = mockEditor.mock.calls[0]?.[0] as {
      internalTargets?: unknown[];
    };

    expect(props.internalTargets).toEqual([
      { type: "note", noteId: "note-1", title: "Current" },
      { type: "note", noteId: "note-2", title: "Research Note" },
      { type: "book", bookId: "book-1", title: "Novel Draft" },
    ]);
  });

  it("does not eagerly load all chapter and heading targets", async () => {
    render(
      <NoteEditor
        note={buildNote({ id: "note-1" })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );

    await Promise.resolve();

    expect(mockListAllChaptersForLinking).not.toHaveBeenCalled();
  });

  it("passes a lazy loader for book, chapter, and note children", async () => {
    render(
      <NoteEditor
        note={buildNote({ id: "note-1" })}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onBack={vi.fn()}
      />,
    );

    const props = mockEditor.mock.calls[0]?.[0] as {
      loadInternalTargetChildren?: (target: {
        type: string;
        bookId?: string;
        chapterId?: string;
        noteId?: string;
        title: string;
      }) => Promise<unknown[]>;
    };

    expect(props.loadInternalTargetChildren).toBeTypeOf("function");

    await expect(
      props.loadInternalTargetChildren?.({
        type: "book",
        bookId: "book-1",
        title: "Novel Draft",
      }),
    ).resolves.toEqual([
      {
        type: "chapter",
        chapterId: "chapter-1",
        title: "Opening Chapter",
        headingId: null,
      },
    ]);

    await expect(
      props.loadInternalTargetChildren?.({
        type: "chapter",
        chapterId: "chapter-1",
        title: "Opening Chapter",
      }),
    ).resolves.toEqual([
      {
        type: "heading",
        chapterId: "chapter-1",
        title: "Opening Scene",
        headingId: "h-opening",
      },
    ]);

    await expect(
      props.loadInternalTargetChildren?.({
        type: "note",
        noteId: "note-2",
        title: "Research Note",
      }),
    ).resolves.toEqual([
      {
        type: "noteHeading",
        noteId: "note-2",
        title: "Research Question",
        headingId: "h-research",
      },
    ]);
  });
});
