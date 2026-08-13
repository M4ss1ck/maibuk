import { fireEvent, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NoteEditor } from "@/components/notes/NoteEditor";
import type { Note, UpdateNoteInput } from "@/features/notes";

const { noteI18nState, platformState, mockNoteSetAlwaysOnTop } = vi.hoisted(() => ({
  noteI18nState: { language: "en" as "en" | "es" },
  platformState: { isDesktop: false },
  mockNoteSetAlwaysOnTop: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { title?: string }) => {
      const map: Record<string, string> = {
        "common.back": noteI18nState.language === "es" ? "Volver" : "Back",
        "common.words": "words",
        "notes.saving": "Saving",
        "notes.saved": "Saved",
        "notes.titlePlaceholder": "Note title",
        "notes.bodyPlaceholder": "Start writing...",
        "notes.pin": "Pin",
        "notes.unpin": "Unpin",
      };
      if (key === "notes.backToBook") return `Back to ${params?.title ?? ""}`;
      return map[key] ?? key;
    },
    i18n: { language: noteI18nState.language },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../../../features/settings/store", () => ({
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTop: false, setAlwaysOnTop: mockNoteSetAlwaysOnTop }),
}));

vi.mock("../../../../components/ThemeToggle", () => ({
  ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("../../../../lib/platform", () => ({
  get IS_ANDROID() {
    return !platformState.isDesktop;
  },
  get IS_DESKTOP() {
    return platformState.isDesktop;
  },
  IS_TAURI: true,
  isMac: () => false,
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

const { noteNavigateMock } = vi.hoisted(() => ({
  noteNavigateMock: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => noteNavigateMock,
}));

vi.mock("../../../../components/editor", () => ({
  Editor: ({
    onUpdate,
    onWordCountChange,
    headerContent,
  }: {
    onUpdate: (content: string) => void;
    onWordCountChange: (count: number) => void;
    headerContent?: React.ReactNode;
  }) => (
    <div>
      {headerContent}
      <button
        type="button"
        onClick={() => {
          onUpdate("<p>Updated body</p>");
          onWordCountChange(42);
        }}
      >
        Apply editor update
      </button>
    </div>
  ),
  SaveStatus: ({ status, onSave }: { status: string; onSave: () => void }) => (
    <button type="button" onClick={onSave}>
      Save status: {status}
    </button>
  ),
}));

function buildNote(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? "note-1",
    title: overrides.title ?? "Initial",
    content: overrides.content ?? "<p>Initial body</p>",
    language: overrides.language ?? "en",
    tags: overrides.tags ?? [],
    pinned: overrides.pinned ?? false,
    order: overrides.order ?? 0,
    wordCount: overrides.wordCount ?? 10,
    collapsedHeadings: overrides.collapsedHeadings ?? [],
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
    contentUpdatedAt: overrides.contentUpdatedAt ?? overrides.updatedAt ?? 1,
  };
}

describe("NoteEditor", () => {
  beforeEach(() => {
    noteI18nState.language = "en";
    noteNavigateMock.mockClear();
    mockNoteSetAlwaysOnTop.mockReset();
    platformState.isDesktop = false;
  });

  it("debounces and saves full payload after content changes", async () => {
    vi.useFakeTimers();
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(<NoteEditor note={buildNote({ pinned: false })} onSave={onSave} />);

    expect(screen.queryByPlaceholderText("Note title")).not.toBeInTheDocument();
    expect(screen.getByText("Initial")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply editor update" }));

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
    });

    expect(onSave).toHaveBeenCalledWith({
      id: "note-1",
      title: "Initial",
      content: "<p>Updated body</p>",
      wordCount: 42,
    });

    vi.useRealTimers();
  });

  it("saves immediately when the manual save button is clicked", async () => {
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(<NoteEditor note={buildNote({ title: "Initial" })} onSave={onSave} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save status/ }));
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", title: "Initial" })
    );
  });

  it("saves immediately when Ctrl+S is pressed", async () => {
    const onSave = vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue();

    render(<NoteEditor note={buildNote({ title: "Initial" })} onSave={onSave} />);

    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note-1", title: "Initial" })
    );
  });

  it("renders a back-to-book button that returns to the book when a target is set", () => {
    const onReturnToBook = vi.fn();

    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
        onReturnToBook={onReturnToBook}
        returnLabel="My Book"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to My Book" }));
    expect(onReturnToBook).toHaveBeenCalled();
  });

  it("exposes a single back action for a standalone note and navigates to /notes", async () => {
    const user = userEvent.setup();
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
      />
    );

    expect(screen.queryByText(/Back to/)).not.toBeInTheDocument();

    const backButton = screen.getByRole("button", { name: "Back" });
    backButton.focus();
    await user.keyboard("{Enter}");
    expect(noteNavigateMock).toHaveBeenCalledWith("/notes");
  });

  it("localizes the single back action in Spanish", () => {
    noteI18nState.language = "es";
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
      />
    );

    expect(screen.getByRole("button", { name: "Volver" })).toBeInTheDocument();
  });

  it("hides the always-on-top pin button on Android (non-desktop)", () => {
    platformState.isDesktop = false;
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
      />
    );

    expect(screen.queryByRole("button", { name: "settings.alwaysOnTop" })).not.toBeInTheDocument();
  });

  it("toggles always-on-top via keyboard on desktop", async () => {
    platformState.isDesktop = true;
    const user = userEvent.setup();
    render(
      <NoteEditor
        note={buildNote({})}
        onSave={vi.fn<(input: UpdateNoteInput) => Promise<void>>().mockResolvedValue()}
      />
    );

    const pinButton = screen.getByRole("button", { name: "settings.alwaysOnTop" });
    pinButton.focus();
    await user.keyboard(" ");

    expect(mockNoteSetAlwaysOnTop).toHaveBeenCalledWith(true);
  });
});
