// Builds the Tutorial Library's sample content (ADR 0008) through the same
// per-entity write paths real content uses, so a schema change breaks the
// Tutorial in tests instead of in an author's hands. Called only while the
// Tutorial Library is active; every id carries the `tutorial-` prefix.

import { applyBookSnapshotData, updateBookRow, updateBookWordCountRow } from "@/features/books/write";
import { updateChapterRow } from "@/features/chapters/write";
import { applyNoteSnapshotData, updateNoteRow } from "@/features/notes/write";
import { applyCanvasSnapshotData } from "@/features/canvas/write";
import { useVersionStore } from "@/features/versions/store";
import { buildTemplateScene } from "@/features/covers/scene/templates";
import { formatLinkUri } from "@/features/links/link-uri";
import { countWords } from "@/features/metrics/word-count";
import { insertEvents } from "@/features/metrics/events-repo";
import { SessionTracker } from "@/features/metrics/session-tracker";
import { CURRENT_CANVAS_SCHEMA_VERSION } from "@/features/canvas/types";
import { isTutorialLibraryActive } from "@/features/tutorial/library-switch";
import { SAMPLE_IDS } from "@/features/tutorial/sample-ids";
import { getDatabase } from "@/lib/db";
import type { BookSnapshot } from "@/features/sync/types";
import type { BookStatus } from "@/features/books/types";
import type { ChapterType } from "@/features/chapters/types";
import type { CanvasDoc } from "@/features/canvas/types";
import type { MetricEvent } from "@/features/metrics/types";

/** Reads one `tutorial.sample.*` string in the author's language. */
export type SampleText = (key: string) => string;

const DAY_SECONDS = 24 * 60 * 60;
const SAMPLE_DEVICE_ID = "tutorial-device";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function paragraph(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}

function htmlWordCount(html: string): number {
  return countWords(new DOMParser().parseFromString(html, "text/html").body.textContent ?? "");
}

function checklist(items: { text: string; done: boolean }[]): string {
  const rows = items
    .map(
      ({ text, done }) =>
        `<li data-type="taskItem" data-checked="${done}"><label><input type="checkbox"${done ? " checked" : ""}><span></span></label><div>${paragraph(text)}</div></li>`
    )
    .join("");
  return `<ul data-type="taskList">${rows}</ul>`;
}

interface SampleChapter {
  id: string;
  title: string;
  content: string;
  chapterType: ChapterType;
}

async function applySampleBook(args: {
  id: string;
  title: string;
  status: BookStatus;
  language: string;
  authorName: string;
  description: string | null;
  genre: string | null;
  createdAt: number;
  lastOpenedAt?: number;
  chapters: SampleChapter[];
}): Promise<void> {
  const snapshot: BookSnapshot = {
    book: {
      id: args.id,
      title: args.title,
      subtitle: null,
      authorName: args.authorName,
      description: args.description,
      genre: args.genre,
      language: args.language,
      coverImagePath: null,
      coverData: null,
      wordCount: 0,
      targetWordCount: null,
      status: args.status,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      contentUpdatedAt: args.createdAt,
      lastOpenedAt: args.lastOpenedAt ?? null,
      lastChapterId: null,
    },
    chapters: args.chapters.map((chapter, order) => ({
      id: chapter.id,
      bookId: args.id,
      title: chapter.title,
      content: chapter.content,
      synopsis: null,
      order,
      parentId: null,
      chapterType: chapter.chapterType,
      wordCount: 0,
      status: "draft",
      isIncludedInExport: true,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    })),
  };
  const applied = await applyBookSnapshotData(snapshot, "local");
  const words = applied.chapters.reduce((total, chapter) => total + chapter.wordCount, 0);
  await updateBookWordCountRow(args.id, words);
}

async function applySampleNote(args: {
  id: string;
  title: string;
  bookId: string | null;
  language: string;
  tags: string[];
  pinned: boolean;
  order: number;
  createdAt: number;
  content: string;
}): Promise<void> {
  await applyNoteSnapshotData(
    {
      note: {
        id: args.id,
        bookId: args.bookId,
        title: args.title,
        content: "",
        language: args.language,
        tags: JSON.stringify(args.tags),
        pinned: args.pinned,
        order: args.order,
        wordCount: 0,
        collapsedHeadings: "[]",
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
        contentUpdatedAt: args.createdAt,
      },
    },
    "local"
  );
  // Content goes through the editing path, which indexes Links (Backlinks).
  await updateNoteRow(
    { id: args.id, content: args.content, wordCount: htmlWordCount(args.content) },
    "local"
  );
}

async function insertSampleWritingSessions(nowMs: number): Promise<void> {
  const events: MetricEvent[] = [];
  const record = (batch: MetricEvent[]) => events.push(...batch);
  // Three Writing Sessions on the last three days, so Metrics has a Streak to show.
  for (const [daysAgo, minutes, words] of [
    [2, 35, 620],
    [1, 50, 910],
    [0, 25, 430],
  ] as const) {
    const start = new Date(nowMs - daysAgo * DAY_SECONDS * 1000 - minutes * 60 * 1000);
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    const tracker = new SessionTracker({
      workId: SAMPLE_IDS.novel,
      deviceId: SAMPLE_DEVICE_ID,
      idleThresholdSec: 0,
      recordEvents: record,
    });
    tracker.start(start);
    tracker.markActive(end);
    tracker.end(end);
    const local = end.toISOString();
    events.push({
      id: `tutorial-writing-${daysAgo}`,
      timestamp: local,
      localDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`,
      tzOffsetMin: -end.getTimezoneOffset(),
      deviceId: SAMPLE_DEVICE_ID,
      eventType: "writing.typed",
      workId: SAMPLE_IDS.novel,
      payload: { words, chars: words * 5, chapterId: SAMPLE_IDS.chapterOne },
      schemaVersion: 1,
    });
  }
  await insertEvents(await getDatabase(), events);
}

/**
 * Seeds the active Tutorial Library: three Books (In Progress with a Prologue,
 * a Part, two Chapters, a Checkpoint, a Named Version and a Cover; one
 * Completed; one Archived), Book and Unfiled Notes with Tags, a pin, a Link
 * and its Backlink and a checklist, a Canvas with every item kind, and a few
 * Writing Sessions.
 */
export async function buildTutorialLibrary(
  text: SampleText,
  language: string,
  nowMs: number = Date.now()
): Promise<void> {
  if (!isTutorialLibraryActive()) {
    throw new Error("The Tutorial Library must be active before sample content is built");
  }
  const now = Math.floor(nowMs / 1000);
  const authorName = text("authorName");

  await applySampleBook({
    id: SAMPLE_IDS.completed,
    title: text("completed.title"),
    status: "completed",
    language,
    authorName,
    description: null,
    genre: null,
    createdAt: now - 60 * DAY_SECONDS,
    chapters: [
      {
        id: SAMPLE_IDS.completedChapter,
        title: text("completed.chapter"),
        content: paragraph(text("completed.text")),
        chapterType: "chapter",
      },
    ],
  });
  await applySampleBook({
    id: SAMPLE_IDS.archived,
    title: text("archived.title"),
    status: "archived",
    language,
    authorName,
    description: null,
    genre: null,
    createdAt: now - 400 * DAY_SECONDS,
    chapters: [
      {
        id: SAMPLE_IDS.archivedChapter,
        title: text("archived.chapter"),
        content: paragraph(text("archived.text")),
        chapterType: "chapter",
      },
    ],
  });

  const chapterOneDraft =
    `<h2>${escapeHtml(text("novel.chapterOne.headingMorning"))}</h2>` +
    `<p>${escapeHtml(text("novel.chapterOne.morning"))}<sup data-footnote="" data-footnote-id="tutorial-footnote-stamp" data-footnote-content="${escapeHtml(text("novel.chapterOne.footnote"))}">*</sup></p>` +
    `<div data-scene-break="" class="scene-break" data-kind="text"><span class="scene-break-symbols">* * *</span></div>` +
    `<h2>${escapeHtml(text("novel.chapterOne.headingStorm"))}</h2>` +
    paragraph(text("novel.chapterOne.storm"));

  // The novel was opened last, so it leads the Gallery.
  await applySampleBook({
    id: SAMPLE_IDS.novel,
    title: text("novel.title"),
    status: "in-progress",
    language,
    authorName,
    description: text("novel.description"),
    genre: text("novel.genre"),
    createdAt: now - 20 * DAY_SECONDS,
    lastOpenedAt: now,
    chapters: [
      {
        id: SAMPLE_IDS.prologue,
        title: text("novel.prologue.title"),
        content: paragraph(text("novel.prologue.text")),
        chapterType: "prologue",
      },
      {
        id: SAMPLE_IDS.part,
        title: text("novel.part.title"),
        content: "",
        chapterType: "part",
      },
      {
        id: SAMPLE_IDS.chapterOne,
        title: text("novel.chapterOne.title"),
        content: chapterOneDraft,
        chapterType: "chapter",
      },
      {
        id: SAMPLE_IDS.chapterTwo,
        title: text("novel.chapterTwo.title"),
        content: paragraph(text("novel.chapterTwo.text")),
        chapterType: "chapter",
      },
    ],
  });

  // History: a Checkpoint of the first draft, one more line, then a Named Version.
  const versions = useVersionStore.getState();
  await versions.createVersion({ bookId: SAMPLE_IDS.novel, triggerType: "auto-idle" });
  await updateChapterRow(
    SAMPLE_IDS.chapterOne,
    { content: chapterOneDraft + paragraph(text("novel.chapterOne.revision")) },
    "local"
  );
  await versions.createVersion({
    bookId: SAMPLE_IDS.novel,
    triggerType: "manual",
    name: text("novel.namedVersion"),
  });

  const cover = buildTemplateScene("classic-centered", {
    title: text("novel.title"),
    author: authorName,
    presetId: "6x9",
  });
  await updateBookRow(
    SAMPLE_IDS.novel,
    { coverData: JSON.stringify(cover), lastChapterId: SAMPLE_IDS.chapterOne },
    "local"
  );

  const tag = (key: string) => text(`tags.${key}`);
  await applySampleNote({
    id: SAMPLE_IDS.noteCharacters,
    title: text("notes.characters.title"),
    bookId: SAMPLE_IDS.novel,
    language,
    tags: [tag("characters")],
    pinned: true,
    order: 0,
    createdAt: now - 18 * DAY_SECONDS,
    content: paragraph(text("notes.characters.text")),
  });
  await applySampleNote({
    id: SAMPLE_IDS.noteResearch,
    title: text("notes.research.title"),
    bookId: SAMPLE_IDS.novel,
    language,
    tags: [tag("research")],
    pinned: false,
    order: 1,
    createdAt: now - 15 * DAY_SECONDS,
    content:
      `<h2>${escapeHtml(text("notes.research.heading"))}</h2>` +
      checklist([
        { text: text("notes.research.itemDone"), done: true },
        { text: text("notes.research.itemOpen"), done: false },
      ]),
  });
  const researchLink = formatLinkUri({ targetType: "note", targetId: SAMPLE_IDS.noteResearch });
  await applySampleNote({
    id: SAMPLE_IDS.noteIdeas,
    title: text("notes.ideas.title"),
    bookId: null,
    language,
    tags: [tag("ideas")],
    pinned: false,
    order: 2,
    createdAt: now - 5 * DAY_SECONDS,
    content: `<p>${escapeHtml(text("notes.ideas.text"))} <a href="${researchLink}">${escapeHtml(text("notes.ideas.linkLabel"))}</a></p>`,
  });
  await applySampleNote({
    id: SAMPLE_IDS.noteChecklist,
    title: text("notes.reading.title"),
    bookId: null,
    language,
    tags: [],
    pinned: false,
    order: 3,
    createdAt: now - 2 * DAY_SECONDS,
    content: checklist([
      { text: text("notes.reading.itemOne"), done: false },
      { text: text("notes.reading.itemTwo"), done: false },
    ]),
  });

  const doc: CanvasDoc = {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    nodes: [
      {
        id: "tutorial-node-storm",
        kind: "text",
        position: { x: 0, y: 0 },
        html: paragraph(text("canvas.storm")),
      },
      {
        id: "tutorial-node-letter",
        kind: "text",
        position: { x: 360, y: 160 },
        html: paragraph(text("canvas.letter")),
      },
      {
        id: "tutorial-node-characters",
        kind: "noteRef",
        position: { x: 0, y: 260 },
        noteId: SAMPLE_IDS.noteCharacters,
        label: text("notes.characters.title"),
      },
    ],
    edges: [
      {
        id: "tutorial-edge-storm-letter",
        source: "tutorial-node-storm",
        target: "tutorial-node-letter",
        label: text("canvas.connection"),
        directed: true,
      },
    ],
    strokes: [
      {
        id: "tutorial-stroke-circle",
        color: "#ef4444",
        width: 3,
        points: [
          { x: 330, y: 130 },
          { x: 420, y: 110 },
          { x: 520, y: 140 },
          { x: 560, y: 210 },
          { x: 500, y: 270 },
          { x: 390, y: 280 },
          { x: 320, y: 230 },
          { x: 330, y: 130 },
        ],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  await applyCanvasSnapshotData(
    {
      canvas: {
        id: SAMPLE_IDS.canvas,
        title: text("canvas.title"),
        pinned: true,
        order: 0,
        doc,
        createdAt: now - 10 * DAY_SECONDS,
        updatedAt: now - 10 * DAY_SECONDS,
        contentUpdatedAt: now - 10 * DAY_SECONDS,
      },
    },
    "local"
  );

  await insertSampleWritingSessions(nowMs);
}
