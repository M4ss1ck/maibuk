// `metricsHistory`: a Book and three consecutive written days ending
// 2026-06-15, so Metrics has a deterministic Streak, Heatmap, time of day,
// and per-book totals under a fixed clock. The metric rows are written
// through `insertEvents` — the same persistence path `metricsService.flushNow`
// uses — against the in-memory Library the seed builder switches on.

import { getDatabase } from "@/lib/db";
import { createBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { insertEvents } from "@/features/metrics/events-repo";
import type { MetricEvent } from "@/features/metrics/types";
import { SEED_BOOK, SEED_CHAPTERS } from "./names";

const DEVICE_ID = "seed-metrics-device";
const BOOK_WORDS = 1200;

/** The three written days; the fixture's clock (see the spec) is 2026-06-15. */
export const METRICS_DAYS = ["2026-06-13", "2026-06-14", "2026-06-15"] as const;

function event(
  id: string,
  timestamp: string,
  localDate: string,
  eventType: MetricEvent["eventType"],
  workId: string | null,
  payload: MetricEvent["payload"]
): MetricEvent {
  return {
    id,
    timestamp,
    localDate,
    tzOffsetMin: 0,
    deviceId: DEVICE_ID,
    eventType,
    workId,
    payload,
    schemaVersion: 1,
  };
}

export async function metricsHistory(): Promise<void> {
  const book = await createBookRow({ ...SEED_BOOK }, "local");
  const chapter = await createChapterRow(
    { bookId: book.id, title: SEED_CHAPTERS[0].title },
    "local"
  );
  await updateChapterRow(chapter.id, { content: `<p>${SEED_CHAPTERS[0].text}</p>` }, "local");
  await updateBookWordCountRow(book.id, BOOK_WORDS);

  const db = await getDatabase();
  await insertEvents(db, [
    // Day 1: 400 words, 15 active minutes.
    event("seed-ty-1", "2026-06-13T09:15:00.000Z", "2026-06-13", "writing.typed", book.id, {
      words: 400,
      chars: 2000,
      chapterId: chapter.id,
    }),
    event("seed-sa-1", "2026-06-13T09:30:00.000Z", "2026-06-13", "session.active", book.id, {
      sessionId: "seed-session-1",
      activeSec: 900,
    }),
    // Day 2: 400 words, 10 active minutes.
    event("seed-ty-2", "2026-06-14T14:00:00.000Z", "2026-06-14", "writing.typed", book.id, {
      words: 400,
      chars: 2000,
      chapterId: chapter.id,
    }),
    event("seed-sa-2", "2026-06-14T14:10:00.000Z", "2026-06-14", "session.active", book.id, {
      sessionId: "seed-session-2",
      activeSec: 600,
    }),
    // Day 3: 500 typed, 100 deleted, 15 active minutes, a 30-minute session.
    event("seed-ty-3", "2026-06-15T08:00:00.000Z", "2026-06-15", "writing.typed", book.id, {
      words: 500,
      chars: 2500,
      chapterId: chapter.id,
    }),
    event("seed-dl-3", "2026-06-15T08:30:00.000Z", "2026-06-15", "writing.deleted", book.id, {
      words: 100,
      chars: 500,
      chapterId: chapter.id,
    }),
    event("seed-sa-3", "2026-06-15T08:40:00.000Z", "2026-06-15", "session.active", book.id, {
      sessionId: "seed-session-3",
      activeSec: 900,
    }),
    event("seed-se-3", "2026-06-15T08:45:00.000Z", "2026-06-15", "session.ended", book.id, {
      sessionId: "seed-session-3",
      durationSec: 2700,
      activeSec: 1800,
      deepestStreakSec: 1800,
    }),
  ]);
}
