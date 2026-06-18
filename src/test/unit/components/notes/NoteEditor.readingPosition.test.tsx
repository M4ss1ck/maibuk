import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "../../../../features/notes";

const { editorProps } = vi.hoisted(() => ({
  editorProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("../../../../features/notes/store", () => {
  const state = {
    notes: [],
    loadNote: vi.fn(),
  };
  const useNoteStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  useNoteStore.getState = () => state;
  return { useNoteStore };
});

vi.mock("../../../../features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ books: [] }),
}));

vi.mock("../../../../features/chapters/store", () => ({
  getChapterForLinking: vi.fn(),
  listChaptersForBookLinking: vi.fn(() => []),
}));

vi.mock("../../../../hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("../../../../lib/shortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("../../../../lib/platform", () => ({ IS_TAURI: false }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("../../../../components/sync/SyncStatusButton", () => ({
  SyncStatusButton: () => null,
}));

vi.mock("../../../../components/notes/NoteBacklinks", () => ({
  NoteBacklinks: () => null,
}));

vi.mock("../../../../components/editor", () => ({
  Editor: (props: Record<string, unknown>) => {
    editorProps.push(props);
    return null;
  },
  SaveStatus: () => null,
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? "n1",
    title: overrides.title ?? "T",
    content: overrides.content ?? "<p>x</p>",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    bookId: overrides.bookId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor reading-position wiring", () => {
  it("passes a note-scoped restoreKey and forwards suppressRestore", () => {
    editorProps.length = 0;

    render(
      <NoteEditor
        note={buildNote({ id: "n1" })}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>()}
        onBack={vi.fn()}
        suppressRestore={true}
      />,
    );

    const last = editorProps[editorProps.length - 1];
    expect(last?.restoreKey).toBe("note:n1");
    expect(last?.suppressRestore).toBe(true);
  });
});
