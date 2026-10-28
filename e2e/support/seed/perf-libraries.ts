// Perf seed Libraries for the frame-rate lane (issue #372), built through the
// real per-entity write paths like every other seed. Their size is the point:
// a long Chapter that makes typing and scrolling work for their frames, and a
// dense Canvas whose pan and zoom move hundreds of Text Nodes and Connections.
// Content is generated from a fixed seed, so every build is byte-for-byte the
// same input and two runs measure the same document.

import { createBookRow, updateBookWordCountRow } from "@/features/books/write";
import { createCanvasRow, updateCanvasDocRow } from "@/features/canvas/write";
import { CURRENT_CANVAS_SCHEMA_VERSION, type CanvasDoc } from "@/features/canvas/types";
import { createChapterRow, updateChapterRow } from "@/features/chapters/write";
import { createNoteRow } from "@/features/notes/write";
import { longChapterHtml, random, sentence } from "@/test/support/long-chapter";
import {
  PERF_BOOK,
  PERF_CANVAS,
  PERF_MANY_CHAPTERS_BOOK,
  PERF_NOTES,
  PERF_SIZES,
  PERF_TAGGED_NOTES,
} from "./names";

async function perfLongChapter(): Promise<void> {
  const book = await createBookRow({ ...PERF_BOOK }, "local");
  let words = 0;
  // Short Chapters first and the long one last: the editor opens the last
  // Chapter, and the keyboard reorder has twenty rows to move through.
  for (let i = 1; i <= PERF_SIZES.shortChapters; i++) {
    const chapter = await createChapterRow({ bookId: book.id, title: `Log ${i}` }, "local");
    const saved = await updateChapterRow(
      chapter.id,
      { content: `<p>Entry ${i}: the lamp was lit at dusk.</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
  const long = await createChapterRow({ bookId: book.id, title: PERF_BOOK.longChapter }, "local");
  const saved = await updateChapterRow(long.id, { content: longChapterHtml() }, "local");
  words += saved?.wordCount ?? 0;
  await updateBookWordCountRow(book.id, words);
}

/** A grid of Text Nodes, each connected to its right and lower neighbors. */
export function denseCanvasDoc(): CanvasDoc {
  const next = random(1372);
  const { columns, rows } = PERF_SIZES.canvasGrid;
  const id = (c: number, r: number) => `perf-${c}-${r}`;
  const nodes: CanvasDoc["nodes"] = [];
  const edges: CanvasDoc["edges"] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      nodes.push({
        id: id(c, r),
        kind: "text",
        html: `<p><strong>${PERF_CANVAS.nodePrefix} ${r * columns + c + 1}</strong></p><p>${sentence(next)}</p>`,
        position: { x: c * 360, y: r * 260 },
        width: 288,
      });
      if (c + 1 < columns) {
        edges.push({
          id: `e-${c}-${r}-right`,
          source: id(c, r),
          target: id(c + 1, r),
          sourceHandle: "right",
          targetHandle: "left",
        });
      }
      if (r + 1 < rows) {
        edges.push({
          id: `e-${c}-${r}-down`,
          source: id(c, r),
          target: id(c, r + 1),
          sourceHandle: "bottom",
          targetHandle: "top",
        });
      }
    }
  }
  return {
    schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
    nodes,
    edges,
    strokes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

async function perfDenseCanvas(): Promise<void> {
  const canvas = await createCanvasRow({ title: PERF_CANVAS.title }, "local");
  await updateCanvasDocRow(canvas.id, denseCanvasDoc(), "local");
}

/** `perfManyNotes`: many short Notes, to stress a long, scrolling Notes list. */
async function perfManyNotes(): Promise<void> {
  const next = random(2372);
  for (let i = 1; i <= PERF_SIZES.manyNotes; i++) {
    await createNoteRow(
      { title: `${PERF_NOTES.titlePrefix} ${i}`, content: `<p>${sentence(next)}</p>` },
      "local"
    );
  }
}

/**
 * `perfTaggedNotes`: 2,000 Notes, each tagged so excluding one Tag drops a
 * third of them, to stress the Notes list when the Note Filter changes.
 */
async function perfTaggedNotes(): Promise<void> {
  const next = random(2872);
  const [task, idea, draft] = PERF_TAGGED_NOTES.tags;
  for (let i = 1; i <= PERF_SIZES.taggedNotes; i++) {
    await createNoteRow(
      {
        title: `${PERF_TAGGED_NOTES.titlePrefix} ${i}`,
        content: `<p>${sentence(next)}</p>`,
        tags: i % 3 === 0 ? [task] : i % 3 === 1 ? [idea] : [idea, draft],
      },
      "local"
    );
  }
}

/** `perfManyChapters`: one Book of many short Chapters, to stress the Outline. */
async function perfManyChapters(): Promise<void> {
  const book = await createBookRow(
    { title: PERF_MANY_CHAPTERS_BOOK.title, authorName: PERF_MANY_CHAPTERS_BOOK.authorName },
    "local"
  );
  let words = 0;
  for (let i = 1; i <= PERF_SIZES.manyChapters; i++) {
    const chapter = await createChapterRow(
      { bookId: book.id, title: `${PERF_MANY_CHAPTERS_BOOK.chapterPrefix} ${i}` },
      "local"
    );
    const saved = await updateChapterRow(
      chapter.id,
      { content: `<p>Entry ${i}: the lamp was lit at dusk.</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
  }
  await updateBookWordCountRow(book.id, words);
}

export const PERF_SEED_LIBRARIES = {
  perfLongChapter,
  perfDenseCanvas,
  perfManyNotes,
  perfTaggedNotes,
  perfManyChapters,
};
