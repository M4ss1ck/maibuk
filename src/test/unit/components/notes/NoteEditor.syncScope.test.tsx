import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note } from "@/features/notes";

const { syncButtonProps } = vi.hoisted(() => ({
  syncButtonProps: { current: null as null | { defaultScope?: string } },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "notes.addTag" ? "Add tag" : key),
    i18n: { language: "en" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: vi.fn() }),
}));

vi.mock("@/components/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

vi.mock("@/components/sync/SyncStatusButton", () => ({
  SyncStatusButton: (props: { defaultScope?: string }) => {
    syncButtonProps.current = props;
    return <button type="button">sync</button>;
  },
}));

vi.mock("@/lib/platform", () => ({
  IS_ANDROID: false,
  IS_TAURI: false,
  IS_DESKTOP: false,
  createDatabase: vi.fn(() =>
    Promise.resolve({
      execute: vi.fn(() => Promise.resolve({ rowsAffected: 0 })),
      select: vi.fn(() => Promise.resolve([])),
      close: vi.fn(() => Promise.resolve()),
      exportData: vi.fn(() => Promise.resolve(new Uint8Array())),
      importData: vi.fn(() => Promise.resolve()),
    })
  ),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/editor", () => ({
  Editor: ({ headerContent }: { headerContent?: React.ReactNode }) => <div>{headerContent}</div>,
  SaveStatus: () => null,
}));

vi.mock("@/features/notes/store", () => ({
  useNoteStore: (selector: (state: { notes: Note[] }) => unknown) => selector({ notes: [] }),
}));

function buildNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "Title",
    content: "<p>Local</p>",
    language: "en",
    tags: [],
    pinned: false,
    order: 0,
    wordCount: 1,
    collapsedHeadings: [],
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    ...overrides,
  };
}

describe("NoteEditor sync scope", () => {
  it("wires the sync button to the Notes scope", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<NoteEditor note={buildNote()} onSave={onSave} />);

    expect(screen.getByRole("button", { name: "sync" })).toBeInTheDocument();
    expect(syncButtonProps.current?.defaultScope).toBe("notes");
  });
});
