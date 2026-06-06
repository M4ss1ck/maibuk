import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "../../../../components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "../../../../features/notes";

const mockNotes: Note[] = [
  {
    id: "note-1",
    title: "One",
    content: "<p>Body</p>",
    tags: ["draft"],
    pinned: false,
    order: 0,
    wordCount: 10,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "note-2",
    title: "Two",
    content: "<p>Other</p>",
    tags: ["research", "ideas"],
    pinned: false,
    order: 1,
    wordCount: 10,
    createdAt: 1,
    updatedAt: 1,
  },
];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "common.back": "Back",
        "common.words": "words",
        "common.add": "Add",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
        "notes.addTag": "Add tag",
        "notes.tags": "Tags",
      };

      return map[key] ?? key;
    },
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => { } },
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
  Editor: ({ headerContent }: { headerContent?: React.ReactNode }) => <div>{headerContent}</div>,
}));

vi.mock("../../../../features/notes/store", () => ({
  useNoteStore: (selector: (state: { notes: Note[] }) => unknown) => selector({ notes: mockNotes }),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "Initial",
    content: overrides.content ?? "<p>Initial body</p>",
    tags: overrides.tags ?? ["draft"],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 10,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor tags", () => {
  it("adds tags through the tag editor and saves with full payload", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(<NoteEditor note={buildNote({ tags: ["draft"] })} onSave={onSave} onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "+ Add" }));
    await user.type(screen.getByRole("combobox"), "rese");
    await user.click(await screen.findByText("research"));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        id: "note-1",
        title: "Initial",
        content: "<p>Initial body</p>",
        wordCount: 10,
        tags: ["draft", "research"],
      });
    });
  });
});
