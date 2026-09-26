// `backupsPresent`: a Library with data worth backing up and restoring — a
// Book with three Chapters, a Book Note, a Canvas, and a manual Version
// (history). Export, Backups, Database File, and Reset rows all start here so
// their destructive paths have something to lose and get back.
//
// The write paths are imported dynamically so specs can import the names
// below without loading app code (`import.meta.env` does not exist in the
// Playwright runner); the seed builder still calls the real write paths.

export const BACKUPS_BOOK = {
  title: "The Keeper's Atlas",
  authorName: "Nora Vance",
} as const;

export const BACKUPS_CHAPTERS = [
  { title: "Landfall", text: "The atlas opened on the harbour at first light." },
  { title: "The Light", text: "Every beacon needs tending before the dark." },
  { title: "Breakwater", text: "The breakwater held against the autumn swell." },
] as const;

export const BACKUPS_NOTE = "Tide Notes";

export const BACKUPS_CANVAS = "Harbor Plan";

export const BACKUPS_VERSION = "First draft";

export async function backupsPresent(): Promise<void> {
  const { createBookRow, updateBookRow, updateBookWordCountRow } = await import(
    "@/features/books/write"
  );
  const { createChapterRow, updateChapterRow } = await import("@/features/chapters/write");
  const { createNoteRow } = await import("@/features/notes/write");
  const { createCanvasRow, updateCanvasDocRow } = await import("@/features/canvas/write");
  const { CURRENT_CANVAS_SCHEMA_VERSION } = await import("@/features/canvas/types");
  const { useVersionStore } = await import("@/features/versions/store");

  const book = await createBookRow({ ...BACKUPS_BOOK }, "local");
  let words = 0;
  let lastChapterId: string | undefined;
  for (const chapter of BACKUPS_CHAPTERS) {
    const created = await createChapterRow({ bookId: book.id, title: chapter.title }, "local");
    const saved = await updateChapterRow(
      created.id,
      { content: `<p>${chapter.text}</p>` },
      "local"
    );
    words += saved?.wordCount ?? 0;
    lastChapterId = created.id;
  }
  await updateBookWordCountRow(book.id, words);
  await updateBookRow(book.id, { status: "in-progress", lastChapterId }, "local");

  await createNoteRow(
    {
      bookId: book.id,
      title: BACKUPS_NOTE,
      content: "<p>High water at six. Low water at noon.</p>",
    },
    "local"
  );

  const canvas = await createCanvasRow({ title: BACKUPS_CANVAS }, "local");
  await updateCanvasDocRow(
    canvas.id,
    {
      schemaVersion: CURRENT_CANVAS_SCHEMA_VERSION,
      nodes: [
        {
          id: "text-harbor",
          kind: "text",
          html: "<p>Chart the breakwater before the tide turns.</p>",
          position: { x: 0, y: 0 },
          width: 288,
        },
      ],
      edges: [],
      strokes: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    "local"
  );

  // A manual Version, so Restore and Reset have history to bring back or clear.
  await useVersionStore
    .getState()
    .createVersion({ bookId: book.id, name: BACKUPS_VERSION, triggerType: "manual" });
}
