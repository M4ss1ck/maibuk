import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { useBookStore } from "@/features/books/store";
import type { Note } from "@/features/notes";
import { useNoteStore } from "@/features/notes/store";
import { useSettingsStore } from "@/features/settings/store";
import { Notes } from "@/pages/Notes";

// Opening a Note paints its loading state first: the Editor's mount blocks the
// thread for as long as the Note is long, so nothing may hide behind it.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/components/notes", () => ({
  NotesList: ({ currentNoteId }: { currentNoteId: string | null }) => (
    <div data-testid="list">{currentNoteId}</div>
  ),
  NoteEditor: ({ note }: { note: { id: string } }) => <div data-testid="editor">{note.id}</div>,
  EmptyNotes: () => <div>empty</div>,
}));

const buildNote = (id: string) =>
  ({ id, title: id, content: "<p>x</p>", tags: [] }) as unknown as Note;

/** A loadNote the test resolves by hand, per Note, the way the store sets currentNote. */
function controlledLoadNote() {
  const pending = new Map<string, () => void>();
  const loadNote = vi.fn(
    (id: string) =>
      new Promise<void>((resolve) => {
        pending.set(id, () => {
          useNoteStore.setState({ currentNote: id === "gone" ? null : buildNote(id) });
          resolve();
        });
      })
  );
  return { loadNote, finish: (id: string) => act(async () => pending.get(id)?.()) };
}

function GoTo({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      go {to}
    </button>
  );
}

function renderNotes(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <GoTo to="/notes/a" />
      <GoTo to="/notes/b" />
      <Routes>
        <Route path="/notes" element={<div>gallery</div>} />
        <Route path="/notes/:noteId" element={<Notes />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The wait for a painted frame is over once the store has been asked for the Note. */
const readStarted = (loadNote: (id: string) => unknown, id: string) =>
  waitFor(() => expect(loadNote).toHaveBeenCalledWith(id));

describe("opening a Note", () => {
  beforeEach(() => {
    useBookStore.setState({ books: [], loadBooks: vi.fn(async () => {}) } as never);
    useSettingsStore.setState({ notesSidebarWidth: 280, setLastNoteId: vi.fn() } as never);
    useNoteStore.setState({ notes: [], currentNote: null, loadNotes: vi.fn(async () => {}) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the loading state, not the empty state, until the Note is read", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");

    expect(screen.getByRole("status")).toHaveTextContent("notes.loading");
    expect(screen.queryByText("empty")).not.toBeInTheDocument();

    await readStarted(loadNote, "a");
    await finish("a");

    expect(screen.getByTestId("editor")).toHaveTextContent("a");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("never mounts an editor for the Note left in the store by an earlier visit", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote, currentNote: buildNote("stale") });
    renderNotes("/notes/a");

    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("list")).toHaveTextContent("a");

    await readStarted(loadNote, "a");
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();

    await finish("a");
    expect(screen.getByTestId("editor")).toHaveTextContent("a");
  });

  it("reads the Note only after a frame, so the loading state can paint first", async () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const { loadNote } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(loadNote).not.toHaveBeenCalled();

    act(() => {
      for (const frame of frames) frame(0);
    });
    // A frame callback runs before its paint: the read waits one more turn.
    expect(loadNote).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(loadNote).toHaveBeenCalledWith("a");
  });

  it("still opens the Note when no frame comes, as in a hidden window", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");

    await readStarted(loadNote, "a");
    await finish("a");

    expect(screen.getByTestId("editor")).toHaveTextContent("a");
  });

  it("goes back to the loading state when the route moves to another Note", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");
    await readStarted(loadNote, "a");
    await finish("a");

    await act(async () => screen.getByRole("button", { name: "go /notes/b" }).click());

    expect(screen.getByRole("status")).toHaveTextContent("notes.loading");
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();

    await readStarted(loadNote, "b");
    await finish("b");
    expect(screen.getByTestId("editor")).toHaveTextContent("b");
  });

  it("is not held on, or thrown off, by a read that ends after the route moved on", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");
    await readStarted(loadNote, "a");

    await act(async () => screen.getByRole("button", { name: "go /notes/b" }).click());
    await readStarted(loadNote, "b");
    await finish("b");
    expect(screen.getByTestId("editor")).toHaveTextContent("b");

    await finish("a");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().setLastNoteId).not.toHaveBeenCalledWith("a");
  });

  it("shows the loading state when the route returns to a Note it had opened", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");
    await readStarted(loadNote, "a");
    await finish("a");

    // Away and back before the read of b ended, with b's row reaching the store.
    await act(async () => screen.getByRole("button", { name: "go /notes/b" }).click());
    await readStarted(loadNote, "b");
    await act(async () => screen.getByRole("button", { name: "go /notes/a" }).click());
    await finish("b");

    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("notes.loading");
  });

  it("leaves for the gallery, not another Note's editor, when the read fails", async () => {
    const loadNote = vi.fn(async () => {
      useNoteStore.setState({ error: "read failed" });
    });
    useNoteStore.setState({ loadNote, currentNote: buildNote("stale") });
    renderNotes("/notes/a");

    expect(await screen.findByText("gallery")).toBeInTheDocument();
    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().setLastNoteId).not.toHaveBeenCalledWith("a");
  });

  it("keeps a Note chosen in the sidebar, which leaves the URL alone", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/a");
    await readStarted(loadNote, "a");
    await finish("a");

    act(() => useNoteStore.setState({ currentNote: buildNote("sidebar") }));

    expect(screen.getByTestId("editor")).toHaveTextContent("sidebar");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("leaves for the gallery when the Note is gone", async () => {
    const { loadNote, finish } = controlledLoadNote();
    useNoteStore.setState({ loadNote });
    renderNotes("/notes/gone");
    await readStarted(loadNote, "gone");
    await finish("gone");

    expect(screen.getByText("gallery")).toBeInTheDocument();
  });
});
