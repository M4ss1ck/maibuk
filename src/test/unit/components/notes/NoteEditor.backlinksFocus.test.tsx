import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "@/features/notes";

const { getBacklinksForNote } = vi.hoisted(() => ({
  getBacklinksForNote: vi.fn(async () => [{ sourceId: "a", title: "Note A" }]),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("@/features/notes/store", () => {
  const state = { notes: [], loadNote: vi.fn() };
  const useNoteStore = (selector: (s: typeof state) => unknown) => selector(state);
  useNoteStore.getState = () => state;
  return { useNoteStore };
});

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ books: [] }),
}));

vi.mock("@/features/chapters/store", () => ({
  getChapterForLinking: vi.fn(),
  listChaptersForBookLinking: vi.fn(() => []),
}));

vi.mock("@/features/links/link-index", () => ({ getBacklinksForNote }));

vi.mock("@/hooks/useAutoSave", () => ({
  useDebouncedCallback: (callback: (...args: unknown[]) => void) => callback,
}));

vi.mock("@/lib/shortcuts", () => ({ useShortcuts: vi.fn() }));
vi.mock("@/lib/platform", () => ({ IS_ANDROID: false, IS_TAURI: false, IS_DESKTOP: false }));

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/sync/SyncStatusButton", () => ({ SyncStatusButton: () => null }));

// The real Editor handles Escape through `onEscape`; this stand-in keeps the
// same contract so the NoteEditor's own focus move is what the test proves.
vi.mock("@/components/editor", () => ({
  Editor: ({ onEscape }: { onEscape?: () => void }) => (
    <div
      role="textbox"
      aria-label="Text"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape?.();
        }
      }}
    />
  ),
  SaveStatus: () => null,
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: overrides.id ?? "n1",
    title: overrides.title ?? "Note",
    content: overrides.content ?? "<p>x</p>",
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 0,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    bookId: overrides.bookId ?? null,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    contentUpdatedAt: overrides.contentUpdatedAt ?? overrides.updatedAt ?? 1,
  };
}

async function focusEditor(user: ReturnType<typeof userEvent.setup>) {
  const text = screen.getByRole("textbox", { name: "Text" });
  for (let i = 0; i < 12 && document.activeElement !== text; i += 1) {
    await user.tab();
  }
  expect(text).toHaveFocus();
}

describe("NoteEditor Escape leaves the editor", () => {
  beforeEach(() => {
    getBacklinksForNote.mockResolvedValue([{ sourceId: "a", title: "Note A" }]);
  });

  it("lands on the first Backlink when another Note links here", async () => {
    const user = userEvent.setup();
    render(<NoteEditor note={buildNote()} onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>()} />);

    const backlink = await screen.findByRole("button", { name: "Note A" });
    await focusEditor(user);
    await user.keyboard("{Escape}");

    expect(backlink).toHaveFocus();
  });

  it("lands on Back when the Note has no Backlinks", async () => {
    getBacklinksForNote.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<NoteEditor note={buildNote()} onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>()} />);

    await waitFor(() => expect(screen.queryByRole("button", { name: "Note A" })).toBeNull());
    await focusEditor(user);
    await user.keyboard("{Escape}");

    expect(screen.getByRole("button", { name: "common.back" })).toHaveFocus();
  });
});
