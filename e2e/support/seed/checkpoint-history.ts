// Named seed Library for Version history (issue #212). A Book whose history
// holds Named Versions and enough rows to paginate, so the panel's list,
// paging, preview, Compare, Restore, rename and delete all have real data.
//
// Built through the real write paths: Chapters through the Chapter writes and
// each Version through the Version store's own createVersion (the same path a
// Mod+Alt+S save takes), so a row here is exactly what the app would store.
//
// createVersion stamps created_at from the wall clock, and every row would
// otherwise land in the same second: the panel sorts by created_at, so which
// Version holds which page (and which row an arrow lands on) would be random.
// The builder steps a fixed seed clock one minute per Version so the order is
// real, deterministic, and the named Versions all sit on page 1.

import { createBookRow, updateBookWordCountRow } from "@/features/books/write";
import {
  createChapterRow,
  deleteChapterRow,
  reorderChapterRows,
  updateChapterRow,
} from "@/features/chapters/write";
import { useVersionStore } from "@/features/versions/store";

/** Visible names the spec locates by. Kept in one place with the builder. */
export const CHECKPOINT_HISTORY = {
  book: "The Lighthouse Keeper",
  authorName: "Ada Marsh",
  firstDraft: "First draft",
  withPrologue: "With prologue",
  currentDraft: "Current draft",
  chapters: {
    arrival: "Arrival",
    lamp: "The Lamp",
    storm: "Storm",
    tide: "Tide",
    prologue: "Prologue",
  },
  entry: {
    arrival: "The ferry left her on the rocks at dusk.",
    storm: "The storm came in from the west without warning.",
    stormModified:
      "The storm came in from the west without warning. The lamp held through the night.",
    tide: "High water at six. Low water at noon.",
    prologue: "A note from the harbour master.",
  },
} as const;

const arrival = CHECKPOINT_HISTORY.entry.arrival;
const storm = CHECKPOINT_HISTORY.entry.storm;
const stormModified = CHECKPOINT_HISTORY.entry.stormModified;
const tide = CHECKPOINT_HISTORY.entry.tide;
const prologue = CHECKPOINT_HISTORY.entry.prologue;

// Filler content so consecutive unnamed Versions never dedup away (createVersion
// drops a snapshot identical to the most recent one).
const FILLER_A = "Fog rolled in and swallowed the pier.";
const FILLER_B = "Gulls wheeled above the empty harbour.";

const words = (text: string): number => text.trim().split(/\s+/).length;

export async function checkpointHistory(): Promise<void> {
  // Version timestamps: one minute apart, starting far enough in the past that
  // any Version a spec creates (idle, close, named) sorts newest on page 1.
  const realNow = Date.now;
  let clock = Date.UTC(2025, 0, 1, 12, 0, 0);
  Date.now = () => clock;

  const manualVersion = async (bookId: string, name?: string): Promise<void> => {
    await useVersionStore.getState().createVersion({ bookId, name, triggerType: "manual" });
    clock += 60_000;
  };

  try {
    const book = await createBookRow(
      { title: CHECKPOINT_HISTORY.book, authorName: CHECKPOINT_HISTORY.authorName },
      "local"
    );
    const arrivalChapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_HISTORY.chapters.arrival },
      "local"
    );
    const lampChapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_HISTORY.chapters.lamp },
      "local"
    );
    const stormChapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_HISTORY.chapters.storm },
      "local"
    );
    const savedArrival = await updateChapterRow(
      arrivalChapter.id,
      { content: `<p>${arrival}</p>` },
      "local"
    );
    const savedLamp = await updateChapterRow(
      lampChapter.id,
      { content: "<p>Every night the lamp needed oil and a steady hand.</p>" },
      "local"
    );
    await updateChapterRow(stormChapter.id, { content: `<p>${storm}</p>` }, "local");

    let total = (savedArrival?.wordCount ?? 0) + (savedLamp?.wordCount ?? 0) + words(storm);
    await updateBookWordCountRow(book.id, total);

    // Older, unnamed Versions so the newest page overflows (page size 10).
    for (let i = 0; i < 6; i++) {
      await updateChapterRow(
        stormChapter.id,
        { content: `<p>${i % 2 === 0 ? FILLER_A : FILLER_B}</p>` },
        "local"
      );
      await manualVersion(book.id);
    }

    // A Named Version with the original three Chapters and Storm's first text.
    await updateChapterRow(stormChapter.id, { content: `<p>${storm}</p>` }, "local");
    await manualVersion(book.id, CHECKPOINT_HISTORY.firstDraft);

    // Storm gains a sentence and a new Chapter: comparing back to "First draft"
    // shows a removed Chapter and a modified one.
    await updateChapterRow(stormChapter.id, { content: `<p>${stormModified}</p>` }, "local");
    const tideChapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_HISTORY.chapters.tide },
      "local"
    );
    await updateChapterRow(tideChapter.id, { content: `<p>${tide}</p>` }, "local");
    total = words(arrival) + 8 + words(stormModified) + words(tide);
    await updateBookWordCountRow(book.id, total);

    // A Named Version that holds a Chapter the current Book no longer has.
    const prologueChapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_HISTORY.chapters.prologue },
      "local"
    );
    await updateChapterRow(prologueChapter.id, { content: `<p>${prologue}</p>` }, "local");
    total += words(prologue);
    await updateBookWordCountRow(book.id, total);
    await manualVersion(book.id, CHECKPOINT_HISTORY.withPrologue);

    await deleteChapterRow(prologueChapter.id, "local");
    total -= words(prologue);
    await updateBookWordCountRow(book.id, total);

    // More unnamed Versions between the Named ones.
    for (let i = 0; i < 3; i++) {
      await updateChapterRow(
        stormChapter.id,
        { content: `<p>${i % 2 === 0 ? FILLER_B : FILLER_A}</p>` },
        "local"
      );
      await manualVersion(book.id);
    }

    // Order the Chapters so the editor opens on Storm (the last one): Restore
    // then visibly replaces the open Chapter's text. Done before the matching
    // Version so the newest Version's snapshot equals the Book exactly.
    await reorderChapterRows(
      book.id,
      [arrivalChapter.id, lampChapter.id, tideChapter.id, stormChapter.id],
      "local"
    );

    // The newest Named Version matches the Book exactly: comparing it shows
    // "No changes", and a Restore of an older one has something to change.
    await updateChapterRow(stormChapter.id, { content: `<p>${stormModified}</p>` }, "local");
    await manualVersion(book.id, CHECKPOINT_HISTORY.currentDraft);
  } finally {
    Date.now = realNow;
  }
}
