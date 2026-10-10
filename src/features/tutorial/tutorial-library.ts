// Entering and leaving the Tutorial Library (ADR 0008). Both run between sync
// runs, so no run ever reads two Libraries, and in a fixed order: pending
// edits land first (a failed save stops entry with nothing switched), then
// metrics settle, then the connection switches, then every view that caches
// Library rows is reloaded.

import { initializeSchema } from "@/lib/db";
import { createMemoryDatabase } from "@/lib/db/memory-database";
import { metricsService } from "@/lib/metrics/MetricsService";
import { countWords } from "@/features/metrics/word-count";
import { flushPendingEdits } from "@/features/sync/pending-edits";
import { emitChange } from "@/features/sync/change-feed";
import { runBetweenSyncRuns } from "@/features/sync/sync-engine";
import { useBookStore } from "@/features/books/store";
import { useChapterStore } from "@/features/chapters/store";
import { useNoteStore } from "@/features/notes/store";
import { useCanvasStore } from "@/features/canvas/store";
import { useVersionStore } from "@/features/versions/store";
import { useEphemeralStore } from "@/features/ephemeral/store";
import { clearLinkPreviewCache } from "@/features/links/link-preview";
import {
  activateTutorialDatabase,
  deactivateTutorialDatabase,
  isTutorialLibraryActive,
  settleAuthorLibraryWork,
} from "@/features/tutorial/library-switch";
import {
  buildTutorialLibrary,
  paragraph,
  type SampleText,
} from "@/features/tutorial/sample-library";

export { isTutorialLibraryActive } from "@/features/tutorial/library-switch";

/**
 * Every store that caches Library rows, and how it is emptied and re-read on
 * a switch. Part of the switch's contract: a store that caches rows and is
 * missing here shows one Library's rows while the other is active.
 * Metrics views (the Metrics page, Settings → Metrics) read on mount and
 * cache nothing between screens.
 */
export const LIBRARY_VIEWS: readonly { name: string; reload: () => Promise<void> }[] = [
  {
    name: "books",
    reload: async () => {
      useBookStore.setState({ books: [], currentBook: null, error: null });
      await useBookStore.getState().refreshBooks();
    },
  },
  {
    name: "chapters",
    reload: async () => {
      useChapterStore.setState({
        chapters: [],
        currentChapter: null,
        currentBookId: null,
        error: null,
      });
    },
  },
  {
    name: "notes",
    reload: async () => {
      useNoteStore.setState({ notes: [], currentNote: null, error: null });
      await useNoteStore.getState().refreshNotes();
    },
  },
  {
    name: "canvases",
    reload: async () => {
      useCanvasStore.getState().closeCanvas();
      useCanvasStore.setState({ canvases: [], galleryLoaded: false, galleryError: null });
      await useCanvasStore.getState().refreshCanvases();
    },
  },
  {
    name: "versions",
    reload: async () => {
      useVersionStore.setState({
        versions: [],
        totalCount: 0,
        currentBookId: null,
        currentPage: 1,
        error: null,
      });
    },
  },
  {
    name: "linkPreviews",
    reload: async () => clearLinkPreviewCache(),
  },
];

async function reloadLibraryViews(): Promise<void> {
  for (const view of LIBRARY_VIEWS) {
    await view.reload();
  }
}

// Ephemeral lives outside the database: the author's buffer is set aside
// while the Tutorial shows its own example, and comes back on exit.
let savedEphemeral: { content: string; wordCount: number } | null = null;

export interface EnterTutorialLibraryOptions {
  /** Reads `tutorial.sample.*` in the author's language. */
  text: SampleText;
  language: string;
}

/**
 * Switches to a fresh in-memory Library seeded with localized sample content.
 * Rejects with the Flush error, and changes nothing, when an open editor
 * cannot save what it holds.
 */
export async function enterTutorialLibrary(options: EnterTutorialLibraryOptions): Promise<void> {
  if (isTutorialLibraryActive()) return;

  await runBetweenSyncRuns(async () => {
    await settleAuthorLibraryWork();
    await flushPendingEdits();
    metricsService.endSession();
    await metricsService.flushNow();

    const database = await createMemoryDatabase();
    await initializeSchema(database);
    activateTutorialDatabase(database);
    // The author's Library is unavailable for as long as the Tutorial Library
    // is active; consumers suspend Library work on this signal.
    await emitChange({ available: false, reason: "tutorial" });
    try {
      await buildTutorialLibrary(options.text, options.language);
    } catch (error) {
      deactivateTutorialDatabase();
      await emitChange({ available: true, reason: "tutorial" });
      await database.close().catch(() => {});
      throw error;
    }
  });

  const ephemeral = useEphemeralStore.getState();
  savedEphemeral = { content: ephemeral.content, wordCount: ephemeral.wordCount };
  const sampleEphemeral = options.text("ephemeral");
  useEphemeralStore.setState({
    content: paragraph(sampleEphemeral),
    wordCount: countWords(sampleEphemeral),
  });

  try {
    await reloadLibraryViews();
  } catch (error) {
    // A half-entered Tutorial Library must never outlive a failed start: the
    // caller drops the run, so nothing would ever switch back and the author
    // would go on writing into memory.
    await exitTutorialLibrary().catch(() => {});
    throw error;
  }
}

/** Switches back to the author's Library and drops the Tutorial Library. */
export async function exitTutorialLibrary(): Promise<void> {
  if (!isTutorialLibraryActive()) return;

  // Availability is tied to the switch itself: announce it whenever the
  // Tutorial database was actually deactivated, even if the task throws after
  // that, and never when the author's Library never came back.
  let deactivated = false;
  try {
    await runBetweenSyncRuns(async () => {
      // Sample editors hold nothing the author wrote; a failed save here only
      // concerns content that is about to be dropped.
      await flushPendingEdits().catch(() => {});
      metricsService.discardSession();
      const database = deactivateTutorialDatabase();
      deactivated = true;
      await database?.close().catch(() => {});
    });
  } finally {
    if (deactivated) await emitChange({ available: true, reason: "tutorial" });
  }

  restoreEphemeral();
  await reloadLibraryViews();
}

function restoreEphemeral(): void {
  if (savedEphemeral) {
    useEphemeralStore.setState(savedEphemeral);
    savedEphemeral = null;
  }
}
