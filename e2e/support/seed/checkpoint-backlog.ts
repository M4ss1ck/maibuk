// Named seed Library for Version Retention (ADR 0033). A Book whose history is
// a months-old backlog of automatic Checkpoints plus one Named Version, so the
// first History load of the session drops every Checkpoint outside the kept
// bins and keeps the Named Version.
//
// Built through the real write paths: the Chapter through the Chapter writes and
// each Version through the Version store's own createVersion, the same path an
// idle Checkpoint takes. The builder steps a fixed seed clock one day per
// Version, so the backlog spans 40 days and every Version is far older than the
// eight-week retention window measured from the real clock.

import { createBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { useVersionStore } from "@/features/versions/store";

/** Visible names the spec locates by. Kept in one place with the builder. */
export const CHECKPOINT_BACKLOG = {
  book: "The Tide Tables",
  authorName: "Ada Marsh",
  chapter: "Tides",
  namedVersion: "Spring draft",
  autoCheckpoints: 40,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

const words = (text: string): number => text.trim().split(/\s+/).length;

export async function checkpointBacklog(): Promise<void> {
  // One day per Version, starting far enough in the past that the whole
  // backlog is outside every retention bin measured from the real clock.
  const realNow = Date.now;
  let clock = Date.UTC(2025, 0, 1, 12, 0, 0);
  Date.now = () => clock;

  try {
    const book = await createBookRow(
      { title: CHECKPOINT_BACKLOG.book, authorName: CHECKPOINT_BACKLOG.authorName },
      "local"
    );
    const chapter = await createChapterRow(
      { bookId: book.id, title: CHECKPOINT_BACKLOG.chapter },
      "local"
    );

    let total = 0;
    for (let day = 1; day <= CHECKPOINT_BACKLOG.autoCheckpoints; day++) {
      // Unique text per Version so the dedup check never skips one.
      const text = `Tide table for day ${day}: high water at ${day % 12 || 12} past six.`;
      const saved = await updateChapterRow(chapter.id, { content: `<p>${text}</p>` }, "local");
      total = saved?.wordCount ?? words(text);
      await updateBookWordCountRow(book.id, total);
      await useVersionStore.getState().createVersion({ bookId: book.id, triggerType: "auto-idle" });
      clock += DAY_MS;
    }

    // The one Named Version, a day after the backlog.
    const named = `<p>Tide table for day ${CHECKPOINT_BACKLOG.autoCheckpoints + 1}: spring edition.</p>`;
    await updateChapterRow(chapter.id, { content: named }, "local");
    await useVersionStore.getState().createVersion({
      bookId: book.id,
      name: CHECKPOINT_BACKLOG.namedVersion,
      triggerType: "manual",
    });
  } finally {
    Date.now = realNow;
  }
}
