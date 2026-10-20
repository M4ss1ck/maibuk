// The #588 demo Plugin: one source file that exercises every Library write the
// issue added, in one run — create a Chapter, move it with chapters.reorder,
// set its title, Chapter Type, and Chapter Status with chapters.update, take a
// Checkpoint with books.checkpoint, and delete a Note with notes.delete.
//
// The integration test (src/test/integration/plugin-library-demo.test.ts) hands
// the exported `runLibraryDemo` the same SDK client a Plugin gets over the real
// broker, because jsdom has no Worker to mount the sandbox in; the tracer
// fixture exports its `setup` the same way. The fixture is never built and
// never shipped.

import type { PluginClient } from "@/plugin-sdk";

/** The Library state the demo works on, named by the host that runs it. */
export interface LibraryDemoOptions {
  bookId: string;
  noteId: string;
  /** The title the new Chapter starts with; update adds ", revised". */
  chapterTitle: string;
  /** The Checkpoint's Version name. */
  checkpointLabel: string;
}

/** What the run produced, so the test can look each change up. */
export interface LibraryDemoResult {
  chapterId: string;
  /** Null when the Book was unchanged since its last Version. */
  versionId: string | null;
}

/**
 * Runs the demo once, in order, through the Plugin API: every call is the one
 * the author's own UI makes, so the Library ends in a state the author can see
 * and undo.
 */
export async function runLibraryDemo(
  client: PluginClient,
  options: LibraryDemoOptions
): Promise<LibraryDemoResult> {
  const { bookId, noteId, chapterTitle, checkpointLabel } = options;

  // 1. A new Chapter at the end of the Book, with content the host sanitizes.
  const { chapterId } = await client.library.chapters.create({
    bookId,
    title: chapterTitle,
    content: { text: "A Chapter the demo Plugin created." },
  });

  // 2. Move it to the front: reorder takes exactly the Book's Chapters.
  const chapters = await client.library.chapters.list({ bookId });
  const chapterIds = [
    chapterId,
    ...chapters.map((chapter) => chapter.id).filter((id) => id !== chapterId),
  ];
  await client.library.chapters.reorder({ bookId, chapterIds });

  // 3. Set its metadata: title, Chapter Type, and Chapter Status.
  await client.library.chapters.update({
    chapterId,
    title: `${chapterTitle}, revised`,
    chapterType: "prologue",
    status: "revised",
  });

  // 4. Take a Checkpoint before the next change, named by the label.
  const { versionId } = await client.library.books.checkpoint({
    bookId,
    label: checkpointLabel,
  });

  // 5. Delete a Note through the normal Delete path.
  await client.library.notes.delete({ noteId });

  return { chapterId, versionId };
}
