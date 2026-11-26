// The Worker's `open` message for the 500-Document Shelf paint bench (#945),
// built by the runner under tsx from Reader's own view model and catalogs. The
// Playwright spec cannot import these Worker modules: their JSON catalogs need
// an import attribute its loader insists on, so the runner writes the message
// to a file and the spec reads it.
import { frameShelfLabels, frameShelfState } from "../../plugins/maibuk-reader/frame-shelf";
import type { ShelfEntry } from "../../plugins/maibuk-reader/shelf";

/** How many Documents the bench Shelf holds. */
export const SHELF_DOCUMENTS = 500;

const FORMATS = ["pdf", "epub", "mobi", "azw3", "fb2", "cbz"] as const;

/** 500 Shelf rows with every status, format, and a spread of dates and progress. */
function shelfRows(): ShelfEntry[] {
  return Array.from({ length: SHELF_DOCUMENTS }, (_, index) => ({
    id: `bench-${index}`,
    grant: `grant-${index}`,
    fingerprint: `${index}:bench`,
    title: `Bench Document ${index + 1}`,
    author: `Author ${(index % 37) + 1}`,
    format: FORMATS[index % FORMATS.length],
    lastReadAt: 1_000_000 - index,
    addedAt: 500_000 + ((index * 7919) % SHELF_DOCUMENTS),
    progress: index % 5 === 0 ? null : { fraction: (index % 100) / 100 },
    state: "ok",
  }));
}

/** The `open` message the Worker sends a Frame opening on that Shelf, in English. */
export function shelfOpenMessage(): Record<string, unknown> {
  return {
    kind: "open",
    view: "shelf",
    entry: null,
    position: null,
    settings: { fontSize: 100, lineWidth: "medium", pdfFit: "width", pdfLayout: "single" },
    size: 0,
    // The reading view's labels: the Frame's own English strings stand in on a
    // Shelf open (`session.ts` pulls in pdf.js assets tsx cannot load).
    labels: null,
    shelf: frameShelfState("en", shelfRows()),
    shelfLabels: frameShelfLabels("en"),
    language: "en",
    appearance: { colorScheme: "light", eink: false },
  };
}
