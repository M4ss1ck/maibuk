// Deterministic inputs for the Note Filter bench (issue #650). The bench
// measures them in the periodic lane (`pnpm bench:notes-filter`); the gate
// lane only checks that the fixture still covers every case and that every
// case removes some Notes, never timings.
//
// No Math.random: a seeded mulberry32 keeps the 5,000 Notes identical on
// every run.
import type { NoteFilterCriteria, NoteWithBook } from "@/components/notes/notes-list-model";

export const NOTES_FILTER_BENCH_SIZE = 5000;

export const TAGS = [
  "task",
  "idea",
  "draft",
  "research",
  "character",
  "plot",
  "world",
  "todo",
  "done",
  "archive",
] as const;

const WORDS = ["alpha", "beta", "gamma", "delta", "echo", "foxtrot", "golf", "hotel"];

/** Seeded LCG (mulberry32); no Math.random so the fixture is deterministic. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function notesFilterBenchNotes(): NoteWithBook[] {
  const rng = createRng(0x9e3779b9);
  const epochMs = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  const notes: NoteWithBook[] = [];

  for (let i = 0; i < NOTES_FILTER_BENCH_SIZE; i += 1) {
    const tagCount = Math.floor(rng() * 5);
    const tags: string[] = [];
    for (const special of ["task", "todo", "done"]) {
      if (tags.length < tagCount && rng() < 0.85) tags.push(special);
    }
    const remaining = TAGS.filter((tag) => !tags.includes(tag));
    while (tags.length < tagCount) {
      const index = Math.floor(rng() * remaining.length);
      tags.push(remaining.splice(index, 1)[0]);
    }

    const pinned = rng() < 0.05;
    const titleWord = WORDS[Math.floor(rng() * WORDS.length)];
    const contentWordCount = 3 + Math.floor(rng() * 5);
    const contentWords: string[] = [];
    for (let w = 0; w < contentWordCount; w += 1) {
      contentWords.push(WORDS[Math.floor(rng() * WORDS.length)]);
    }
    const content = `<p>${contentWords.join(" ")}</p>`;
    const bookId = rng() < 0.5 ? null : `bench-book-${Math.floor(rng() * 20)}`;
    const timestampMs = epochMs - Math.floor(rng() * 365) * dayMs;
    const seconds = Math.floor(timestampMs / 1000);

    notes.push({
      id: `bench-note-${i}`,
      bookId,
      title: `${titleWord} note ${i}`,
      content,
      language: "en",
      tags,
      pinned,
      order: i,
      wordCount: Math.floor(rng() * 200),
      collapsedHeadings: [],
      createdAt: seconds,
      updatedAt: seconds,
      contentUpdatedAt: seconds,
    });
  }

  return notes;
}

const epochMs = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
const dayMs = 24 * 60 * 60 * 1000;
const dateFrom = formatDate(epochMs - 180 * dayMs);
const dateTo = formatDate(epochMs - 90 * dayMs);

export const NOTES_FILTER_BENCH_CASES: readonly { name: string; criteria: NoteFilterCriteria }[] = [
  { name: "exclude: task", criteria: { excludeTags: ["task"] } },
  { name: "include: idea+draft", criteria: { tags: ["idea", "draft"] } },
  { name: "exclude: task+todo+done", criteria: { excludeTags: ["task", "todo", "done"] } },
  { name: "date range: 90 days", criteria: { dateFrom, dateTo } },
  { name: "all criteria", criteria: { tags: ["idea"], excludeTags: ["task"], dateFrom, dateTo } },
];
