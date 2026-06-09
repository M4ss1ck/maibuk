import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseAdapter } from "../../../../lib/platform/types";
import { createTestDatabase } from "../../../support/db-test-context";

// --- Mock getDatabase ---
let testDb: DatabaseAdapter;

const { mockGetDatabase } = vi.hoisted(() => ({
  mockGetDatabase: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getDatabase: mockGetDatabase,
}));

const { useNoteStore } = await import("../../../../features/notes/store");

describe("useNoteStore", () => {
  beforeEach(async () => {
    testDb = await createTestDatabase();
    mockGetDatabase.mockResolvedValue(testDb);

    useNoteStore.setState({
      notes: [],
      currentNote: null,
      isLoading: false,
      error: null,
    });
  });

  describe("initial state", () => {
    it("starts empty", () => {
      const state = useNoteStore.getState();
      expect(state.notes).toEqual([]);
      expect(state.currentNote).toBeNull();
      expect(state.isLoading).toBe(false);
    });
  });

  describe("createNote()", () => {
    it("creates a note with auto-assigned order", async () => {
      const first = await useNoteStore.getState().createNote({ title: "First" });
      const second = await useNoteStore.getState().createNote({ title: "Second" });

      expect(first.order).toBe(0);
      expect(second.order).toBe(1);
      expect(useNoteStore.getState().notes).toHaveLength(2);
    });

    it("persists tags and pinned through the round-trip", async () => {
      const created = await useNoteStore
        .getState()
        .createNote({ title: "Tagged", tags: ["a", "b"], pinned: true });

      await useNoteStore.getState().loadNote(created.id);
      const loaded = useNoteStore.getState().currentNote;

      expect(loaded?.tags).toEqual(["a", "b"]);
      expect(loaded?.pinned).toBe(true);
    });
  });

  describe("loadNotes()", () => {
    it("loads notes with pinned first, then by order", async () => {
      await useNoteStore.getState().createNote({ title: "A" });
      const b = await useNoteStore.getState().createNote({ title: "B" });
      await useNoteStore.getState().createNote({ title: "C" });
      await useNoteStore.getState().updateNote({ id: b.id, pinned: true });

      await useNoteStore.getState().loadNotes();
      const titles = useNoteStore.getState().notes.map((n) => n.title);

      expect(titles).toEqual(["B", "A", "C"]);
    });
  });

  describe("loadNote()", () => {
    it("sets currentNote to null when the note does not exist", async () => {
      await useNoteStore.getState().loadNote("missing-id");
      expect(useNoteStore.getState().currentNote).toBeNull();
    });
  });

  describe("updateNote()", () => {
    it("updates fields and currentNote when it matches", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Draft" });
      useNoteStore.getState().setCurrentNote(note);

      await useNoteStore
        .getState()
        .updateNote({ id: note.id, title: "Final", content: "<p>hi</p>", wordCount: 1 });

      const updated = useNoteStore.getState().notes.find((n) => n.id === note.id);
      expect(updated?.title).toBe("Final");
      expect(updated?.content).toBe("<p>hi</p>");
      expect(updated?.wordCount).toBe(1);
      expect(useNoteStore.getState().currentNote?.title).toBe("Final");
    });
  });

  describe("deleteNote()", () => {
    it("records a pending sync tombstone before deleting the note", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Idea" });

      await useNoteStore.getState().deleteNote(note.id);

      const tombstones = await testDb.select<Record<string, unknown>[]>(
        "SELECT entity_type, entity_id, title, confirmed_at, pushed_at FROM sync_tombstones WHERE entity_id = ?",
        [note.id],
      );
      expect(tombstones).toEqual([
        {
          entity_type: "note",
          entity_id: note.id,
          title: "Idea",
          confirmed_at: null,
          pushed_at: null,
        },
      ]);
    });

    it("removes the note and clears currentNote when it matches", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Temp" });
      useNoteStore.getState().setCurrentNote(note);

      await useNoteStore.getState().deleteNote(note.id);

      expect(useNoteStore.getState().notes).toHaveLength(0);
      expect(useNoteStore.getState().currentNote).toBeNull();
    });
  });

  describe("reorderNotes()", () => {
    it("applies the new order", async () => {
      const a = await useNoteStore.getState().createNote({ title: "A" });
      const b = await useNoteStore.getState().createNote({ title: "B" });
      const c = await useNoteStore.getState().createNote({ title: "C" });

      await useNoteStore.getState().reorderNotes([c.id, a.id, b.id]);
      await useNoteStore.getState().loadNotes();

      expect(useNoteStore.getState().notes.map((n) => n.title)).toEqual(["C", "A", "B"]);
    });
  });

  describe("saveCollapsedHeadings()", () => {
    it("saves collapsed headings and updates local state", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-06-08T00:00:00Z"));
        const note = await useNoteStore.getState().createNote({ title: "Test" });
        expect(note.collapsedHeadings).toEqual([]);

        vi.setSystemTime(new Date("2026-06-08T00:01:00Z"));
        await useNoteStore.getState().saveCollapsedHeadings(note.id, ["h1", "h2"]);

        const updated = useNoteStore.getState().notes.find((n) => n.id === note.id);
        expect(updated?.collapsedHeadings).toEqual(["h1", "h2"]);
        expect(updated?.updatedAt).toBe(note.updatedAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it("updates currentNote when it matches", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Current" });
      useNoteStore.getState().setCurrentNote(note);

      await useNoteStore.getState().saveCollapsedHeadings(note.id, ["abc"]);

      expect(useNoteStore.getState().currentNote?.collapsedHeadings).toEqual(["abc"]);
    });

    it("persists collapsed headings through a round-trip", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Persist" });
      await useNoteStore.getState().saveCollapsedHeadings(note.id, ["h1", "h2"]);

      await useNoteStore.getState().loadNote(note.id);
      const loaded = useNoteStore.getState().currentNote;
      expect(loaded?.collapsedHeadings).toEqual(["h1", "h2"]);
    });

    it("clears collapsed headings with empty array", async () => {
      const note = await useNoteStore.getState().createNote({ title: "Clear" });
      await useNoteStore.getState().saveCollapsedHeadings(note.id, ["h1"]);
      await useNoteStore.getState().saveCollapsedHeadings(note.id, []);

      const updated = useNoteStore.getState().notes.find((n) => n.id === note.id);
      expect(updated?.collapsedHeadings).toEqual([]);
    });
  });
});
