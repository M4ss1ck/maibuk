/**
 * The Shelf's Frame view model (#944): the wire-safe rows the Frame draws, the
 * localized copy around them, and the stable tone a generated cover takes.
 * The File Grant and Fingerprint never leave the Worker, so every row here is
 * checked for their absence as well as for its progress and status lines.
 */

import { describe, expect, it } from "vitest";
import {
  frameImportState,
  frameShelfEntry,
  frameShelfLabels,
  frameShelfState,
  shelfRemovalCopy,
  shelfTone,
} from "./frame-shelf";
import {
  DEFAULT_SHELF_VIEW as FRAME_DEFAULT_SHELF_VIEW,
  defaultDescending as frameDefaultDescending,
  SHELF_SORTS,
  sortSummary,
} from "./frame/shelf-options";
import { fill } from "./frame/shelf-query";
import type { CollidingDocument, ImportReport, ImportSource } from "./import";
import { DEFAULT_SHELF_VIEW, defaultDescending } from "./shelf";
import { shelfEntry } from "./test-support";

const LABELS_EN = {
  shelf: "Shelf",
  import: "Import",
  importFiles: "Import files",
  emptyTitle: "Your Shelf is empty",
  emptyDescription: "Open PDF, EPUB, MOBI, AZW3, FB2, or CBZ files from your device.",
  loading: "Loading your Shelf…",
  error: "Reader couldn't load your Shelf.",
  documentsCountOne: "{{count}} Document",
  documentsCountOther: "{{count}} Documents",
  open: "Open",
  remove: "Remove from Shelf…",
  locate: "Locate",
  missing: "Missing",
  moreFor: "More for {{title}}",
  removeConfirm: "Remove",
  cancel: "Cancel",
  newLabel: "New",
  finishedLabel: "Finished",
  documentActions: "Document actions",
  dismiss: "Dismiss",
  allDocuments: "All Documents",
  shownOf: "{{shown}} of {{total}}",
  searchLabel: "Search the Shelf",
  searchPlaceholder: "Search title or author",
  closeSearch: "Close search",
  clearSearch: "Clear search",
  searchMatchesOne: '{{count}} Document matches "{{search}}" · {{layout}}',
  searchMatchesOther: '{{count}} Documents match "{{search}}" · {{layout}}',
  gridView: "Grid view",
  listView: "List view",
  compactView: "Compact view",
  viewOptions: "View, sort and filter",
  viewOptionsTitle: "View and filters",
  reset: "Reset",
  done: "Done",
  layout: "View",
  layoutLabel: "Shelf view",
  layoutGrid: "Grid",
  layoutList: "List",
  layoutCompact: "Compact",
  coverSize: "Cover size",
  coverSmall: "Small",
  coverMedium: "Medium",
  coverLarge: "Large",
  coverSmallShort: "S",
  coverMediumShort: "M",
  coverLargeShort: "L",
  sortBy: "Sort by",
  sortRecent: "Recent",
  sortTitle: "Title",
  sortAuthor: "Author",
  sortProgress: "Progress",
  sortAdded: "Date added",
  reverseOrder: "Reverse order",
  reverseOrderValue: "Reverse order: {{direction}}",
  sortSummary: "{{sort}} · {{direction}}",
  sortByValue: "Sort by: {{sort}}",
  newestFirst: "Newest first",
  oldestFirst: "Oldest first",
  aToZ: "A to Z",
  zToA: "Z to A",
  mostReadFirst: "Most read first",
  leastReadFirst: "Least read first",
  recentFirst: "Recent first",
  filters: "Filters",
  status: "Status",
  format: "Format",
  all: "All",
  statusNew: "New",
  statusReading: "Reading",
  statusFinished: "Finished",
  statusChip: "Status: {{status}}",
  formatChip: "Format: {{format}}",
  removeFilter: "Remove filter {{filter}}",
  clearFilters: "Clear filters",
  noMatch: "No Documents match",
  remembered: "Showing {{shown}} of {{total}}. Reader remembers these choices on this device.",
  collections: "Collections",
  newCollection: "New Collection",
  newCollectionName: "New Collection name",
  add: "Add",
  railHint: "Drag a Document onto a Collection, or use its menu.",
  collection: "Collection",
  anyCollection: "Any Collection",
  collectionChip: "Collection: {{name}}",
  moreForCollection: "More for {{name}}",
  collectionName: "Name",
  create: "Create",
  renameCollection: "Rename Collection",
  renameAction: "Rename…",
  rename: "Rename",
  deleteAction: "Delete…",
  deleteCollectionTitle: "Delete “{{name}}”?",
  deleteCollectionBody: "Its Documents stay on the Shelf.",
  delete: "Delete",
  duplicateCollection: "A Collection with that name already exists.",
  noCollections: "No Collections yet",
  importDescription:
    "PDF, EPUB, MOBI, AZW3, FB2 and CBZ. Reader opens files where they are and never copies them.",
  importFilesOption: "Files",
  importFilesHint: "Pick one or several files.",
  importFolderOption: "Folder",
  importFolderHint:
    "Every supported file in a folder and its subfolders. Reader reads it once, now, and does not watch it. Importing it again adds only what is new.",
  importFolder: "Import folder",
  importClose: "Close",
  importProgressLabel: "Import progress",
  importCancel: "Cancel",
  importViewReport: "View report",
  importDismiss: "Dismiss",
  importKeepReading:
    "Keep reading; the import runs in the background. Cancel keeps what was added.",
  reportTitle: "Import report",
  reportAdded: "Added",
  reportAlreadyOnShelf: "Already on the Shelf",
  reportRelinked: "Relinked (were Missing)",
  reportRelinkedShort: "Relinked",
  reportUnreadable: "Unreadable",
  reportUnreadableHint: "Reader could not open these. Deal with them outside Reader.",
  reportDetails: "Details",
  reportNone: "None",
  reportCollisionsTile: "Collisions to resolve",
  reportCollisions: "Collisions",
  reportCollisionsHint: "Same title and author as a Shelf Document, different file.",
  applyToAll: "Apply to all",
  applyToAllLabel: "Apply to all collisions",
  keepBoth: "Keep both",
  replace: "Replace",
  skip: "Skip",
  onTheShelf: "On the Shelf",
  newFile: "New file",
  closeDecideLater: "Close, decide later",
  applyChoices: "Apply choices",
  importCollectFolder: "Put a folder's Documents in a Collection named after the folder",
  importCollectFolderHint: "Folder imports only. Reader remembers this choice.",
};

const LABELS_ES = {
  shelf: "Estante",
  import: "Importar",
  importFiles: "Importar archivos",
  emptyTitle: "Tu estante está vacío",
  emptyDescription: "Abre archivos PDF, EPUB, MOBI, AZW3, FB2 o CBZ desde tu dispositivo.",
  loading: "Cargando tu estante…",
  error: "Lector no pudo cargar tu estante.",
  documentsCountOne: "{{count}} documento",
  documentsCountOther: "{{count}} documentos",
  open: "Abrir",
  remove: "Quitar del estante…",
  locate: "Localizar",
  missing: "Perdido",
  moreFor: "Más de {{title}}",
  removeConfirm: "Quitar",
  cancel: "Cancelar",
  newLabel: "Nuevo",
  finishedLabel: "Terminado",
  documentActions: "Acciones del documento",
  dismiss: "Cerrar",
  allDocuments: "Todos los documentos",
  shownOf: "{{shown}} de {{total}}",
  searchLabel: "Buscar en el estante",
  searchPlaceholder: "Buscar título o autor",
  closeSearch: "Cerrar búsqueda",
  clearSearch: "Borrar búsqueda",
  searchMatchesOne: "{{count}} documento coincide con «{{search}}» · {{layout}}",
  searchMatchesOther: "{{count}} documentos coinciden con «{{search}}» · {{layout}}",
  gridView: "Vista de cuadrícula",
  listView: "Vista de lista",
  compactView: "Vista compacta",
  viewOptions: "Vista, orden y filtros",
  viewOptionsTitle: "Vista y filtros",
  reset: "Restablecer",
  done: "Listo",
  layout: "Vista",
  layoutLabel: "Vista del estante",
  layoutGrid: "Cuadrícula",
  layoutList: "Lista",
  layoutCompact: "Compacta",
  coverSize: "Tamaño de portada",
  coverSmall: "Pequeña",
  coverMedium: "Mediana",
  coverLarge: "Grande",
  coverSmallShort: "P",
  coverMediumShort: "M",
  coverLargeShort: "G",
  sortBy: "Ordenar por",
  sortRecent: "Recientes",
  sortTitle: "Título",
  sortAuthor: "Autor",
  sortProgress: "Progreso",
  sortAdded: "Fecha de adición",
  reverseOrder: "Invertir orden",
  reverseOrderValue: "Invertir orden: {{direction}}",
  sortSummary: "{{sort}} · {{direction}}",
  sortByValue: "Ordenar por: {{sort}}",
  newestFirst: "Más recientes primero",
  oldestFirst: "Más antiguos primero",
  aToZ: "De la A a la Z",
  zToA: "De la Z a la A",
  mostReadFirst: "Más leídos primero",
  leastReadFirst: "Menos leídos primero",
  recentFirst: "Recientes primero",
  filters: "Filtros",
  status: "Estado",
  format: "Formato",
  all: "Todos",
  statusNew: "Nuevo",
  statusReading: "Leyendo",
  statusFinished: "Terminado",
  statusChip: "Estado: {{status}}",
  formatChip: "Formato: {{format}}",
  removeFilter: "Quitar filtro {{filter}}",
  clearFilters: "Borrar filtros",
  noMatch: "Ningún documento coincide",
  remembered:
    "Mostrando {{shown}} de {{total}}. Reader recuerda estas opciones en este dispositivo.",
  collections: "Colecciones",
  newCollection: "Nueva colección",
  newCollectionName: "Nombre de la nueva colección",
  add: "Añadir",
  railHint: "Arrastra un documento a una colección, o usa su menú.",
  collection: "Colección",
  anyCollection: "Cualquier colección",
  collectionChip: "Colección: {{name}}",
  moreForCollection: "Más opciones de {{name}}",
  collectionName: "Nombre",
  create: "Crear",
  renameCollection: "Cambiar nombre de la colección",
  renameAction: "Cambiar nombre…",
  rename: "Cambiar nombre",
  deleteAction: "Eliminar…",
  deleteCollectionTitle: "¿Eliminar «{{name}}»?",
  deleteCollectionBody: "Sus documentos se quedan en el estante.",
  delete: "Eliminar",
  duplicateCollection: "Ya existe una colección con ese nombre.",
  noCollections: "Aún no hay colecciones",
  importDescription:
    "PDF, EPUB, MOBI, AZW3, FB2 y CBZ. Reader abre los archivos donde están y nunca los copia.",
  importFilesOption: "Archivos",
  importFilesHint: "Elige uno o varios archivos.",
  importFolderOption: "Carpeta",
  importFolderHint:
    "Cada archivo compatible de una carpeta y sus subcarpetas. Reader la lee una vez, ahora, y no la vigila. Importarla de nuevo solo añade lo nuevo.",
  importFolder: "Importar carpeta",
  importClose: "Cerrar",
  importProgressLabel: "Progreso de la importación",
  importCancel: "Cancelar",
  importViewReport: "Ver informe",
  importDismiss: "Descartar",
  importKeepReading:
    "Sigue leyendo; la importación continúa en segundo plano. Cancelar conserva lo añadido.",
  reportTitle: "Informe de importación",
  reportAdded: "Añadidos",
  reportAlreadyOnShelf: "Ya en el estante",
  reportRelinked: "Revinculados (estaban perdidos)",
  reportRelinkedShort: "Revinculados",
  reportUnreadable: "Ilegibles",
  reportUnreadableHint: "Reader no pudo abrirlos. Resuélvelos fuera de Reader.",
  reportDetails: "Detalles",
  reportNone: "Ninguno",
  reportCollisionsTile: "Colisiones por resolver",
  reportCollisions: "Colisiones",
  reportCollisionsHint: "Mismo título y autor que un documento del estante, otro archivo.",
  applyToAll: "Aplicar a todas",
  applyToAllLabel: "Aplicar a todas las colisiones",
  keepBoth: "Conservar ambos",
  replace: "Reemplazar",
  skip: "Omitir",
  onTheShelf: "En el estante",
  newFile: "Archivo nuevo",
  closeDecideLater: "Cerrar y decidir después",
  applyChoices: "Aplicar elecciones",
  importCollectFolder:
    "Poner los documentos de una carpeta en una colección con el nombre de la carpeta",
  importCollectFolderHint: "Solo al importar carpetas. Reader recuerda esta elección.",
};

describe("shelfTone()", () => {
  it("is stable for one Document and one of the eight cover tones", () => {
    expect(shelfTone("doc-1")).toBe(shelfTone("doc-1"));
    for (const id of ["doc-1", "doc-2", "dune", "a", ""]) {
      const tone = shelfTone(id);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(8);
    }
    expect(shelfTone("doc-1")).not.toBe(shelfTone("doc-2"));
  });
});

describe("frameShelfEntry()", () => {
  it("maps a page out of its count", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "g1", progress: { page: 34, pageCount: 210 } })
    );
    expect(mapped.progressText).toBe("p. 34 of 210");
    expect(mapped.progressPercent).toBe(16);
  });

  it("maps a fraction to a whole percentage", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "g1", progress: { fraction: 0.423 } })
    );
    expect(mapped.progressText).toBe("42%");
    expect(mapped.progressPercent).toBe(42);
  });

  it("says New when nothing is known yet", () => {
    const mapped = frameShelfEntry("en", shelfEntry({ id: "doc-1", grant: "g1", progress: null }));
    expect(mapped.progressText).toBe("New");
    expect(mapped.progressPercent).toBeNull();
  });

  it("says Finished at a whole fraction, even beside a page count", () => {
    const whole = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "g1", progress: { fraction: 1 } })
    );
    expect(whole.progressText).toBe("Finished");
    expect(whole.progressPercent).toBe(100);
    const wholeWithPages = frameShelfEntry(
      "en",
      shelfEntry({
        id: "doc-1",
        grant: "g1",
        progress: { page: 210, pageCount: 210, fraction: 1 },
      })
    );
    expect(wholeWithPages.progressText).toBe("Finished");
    expect(wholeWithPages.progressPercent).toBe(100);
  });

  it("carries the status, the dates, and the progress fraction for the Frame's sort and filter", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({
        id: "doc-1",
        grant: "g1",
        lastReadAt: 5_000,
        addedAt: 2_000,
        progress: { page: 3, pageCount: 10 },
      })
    );
    expect(mapped).toMatchObject({
      status: "reading",
      lastReadAt: 5_000,
      addedAt: 2_000,
      progress: 0.3,
    });
  });

  it("reads a Document at 99.5% as Finished, at 100 percent", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "g1", progress: { fraction: 0.995 } })
    );
    expect(mapped.status).toBe("finished");
    expect(mapped.progressText).toBe("Finished");
    expect(mapped.progressPercent).toBe(100);
    expect(mapped.progress).toBe(0.995);
  });

  it("reads the last page of a Document as Finished", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "g1", progress: { page: 12, pageCount: 12 } })
    );
    expect(mapped.status).toBe("finished");
    expect(mapped.progressText).toBe("Finished");
    expect(mapped.progressPercent).toBe(100);
  });

  it("reads a Document nothing is known about as new, with no progress", () => {
    const mapped = frameShelfEntry("en", shelfEntry({ id: "doc-1", grant: "g1", progress: null }));
    expect(mapped.status).toBe("new");
    expect(mapped.progress).toBe(0);
  });

  it("says Missing for both a Missing Document and a permission re-request", () => {
    expect(
      frameShelfEntry("en", shelfEntry({ id: "doc-1", grant: "g1", state: "missing" })).statusText
    ).toBe("Missing");
    expect(
      frameShelfEntry("en", shelfEntry({ id: "doc-2", grant: "g2", state: "needs-permission" }))
        .statusText
    ).toBe("Missing");
  });

  it("says a file is unreadable, and keeps a readable row's status empty", () => {
    expect(
      frameShelfEntry("en", shelfEntry({ id: "doc-1", grant: "g1", state: "unreadable" }))
        .statusText
    ).toBe("Can't open this file");
    expect(frameShelfEntry("en", shelfEntry({ id: "doc-2", grant: "g2" })).statusText).toBeNull();
  });

  it("localizes the progress and status lines", () => {
    const mapped = frameShelfEntry(
      "es",
      shelfEntry({
        id: "doc-1",
        grant: "g1",
        state: "missing",
        progress: { page: 34, pageCount: 210 },
      })
    );
    expect(mapped.progressText).toBe("pág. 34 de 210");
    expect(mapped.statusText).toBe("Perdido");
    expect(
      frameShelfEntry("es", shelfEntry({ id: "doc-2", grant: "g2", state: "needs-permission" }))
        .statusText
    ).toBe("Perdido");
    expect(
      frameShelfEntry("es", shelfEntry({ id: "doc-3", grant: "g3", state: "unreadable" }))
        .statusText
    ).toBe("No se puede abrir este archivo");
  });

  it("carries only what the Frame draws, never the File Grant or Fingerprint", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({
        id: "doc-1",
        grant: "grant-secret",
        fingerprint: "fp-secret",
        title: "Dune",
        author: "Frank Herbert",
        format: "epub",
        coverDataUrl: "data:image/webp;base64,AAAA",
      })
    );
    expect(mapped).toEqual({
      id: "doc-1",
      title: "Dune",
      author: "Frank Herbert",
      format: "epub",
      state: "ok",
      coverDataUrl: "data:image/webp;base64,AAAA",
      progressText: "New",
      progressPercent: null,
      statusText: null,
      tone: shelfTone("doc-1"),
      status: "new",
      lastReadAt: 1_000,
      addedAt: 1_000,
      progress: 0,
    });
    expect(mapped).not.toHaveProperty("grant");
    expect(mapped).not.toHaveProperty("fingerprint");
    expect(JSON.stringify(mapped)).not.toContain("grant-secret");
    expect(JSON.stringify(mapped)).not.toContain("fp-secret");
  });

  it("reads an opened Document with no saved position as reading at 0%", () => {
    const mapped = frameShelfEntry(
      "en",
      shelfEntry({ id: "doc-1", grant: "grant-1", progress: null, openedAt: 2_000 })
    );
    expect(mapped.status).toBe("reading");
    expect(mapped.progressText).toBe("0%");
    expect(mapped.progressPercent).toBe(0);
  });

  it("leaves the cover out when the row has none", () => {
    const mapped = frameShelfEntry("en", shelfEntry({ id: "doc-1", grant: "g1" }));
    expect(mapped).not.toHaveProperty("coverDataUrl");
  });
});

describe("frameShelfState()", () => {
  it("maps every row of a ready Shelf", () => {
    const state = frameShelfState("en", [
      shelfEntry({ id: "doc-1", grant: "g1" }),
      shelfEntry({ id: "doc-2", grant: "g2", state: "missing" }),
    ]);
    expect(state.status).toBe("ready");
    expect(state.entries.map((entry) => entry.id)).toEqual(["doc-1", "doc-2"]);
    expect(state.entries[1].statusText).toBe("Missing");
  });
});

describe("frameShelfLabels()", () => {
  it("builds every English label from the runtime catalog", () => {
    expect(frameShelfLabels("en")).toEqual(LABELS_EN);
  });

  it("builds every Spanish label from the runtime catalog", () => {
    expect(frameShelfLabels("es")).toEqual(LABELS_ES);
  });

  it("composes the sort summary and the sort and reverse names from one string each", () => {
    const es = frameShelfLabels("es");
    const byTitle = { ...DEFAULT_SHELF_VIEW, sort: "title", descending: false } as const;
    expect(sortSummary(es, byTitle)).toBe("Título · De la A a la Z");
    expect(fill(es.sortByValue, { sort: es.sortTitle })).toBe("Ordenar por: Título");
    expect(fill(es.reverseOrderValue, { direction: es.aToZ })).toBe(
      "Invertir orden: De la A a la Z"
    );
  });

  it("follows the base language and falls back to English", () => {
    expect(frameShelfLabels("es-MX")).toEqual(LABELS_ES);
    expect(frameShelfLabels("fr")).toEqual(LABELS_EN);
  });
});

describe("shelfRemovalCopy()", () => {
  it("states the real counts, with plural Bookmarks and Highlights", () => {
    expect(shelfRemovalCopy("en", "Dune", { bookmarks: 3, highlights: 12, notes: 5 })).toEqual({
      title: 'Remove "Dune" from the Shelf?',
      body: "Its 3 Bookmarks and 12 Highlights (5 with notes) are deleted too.",
      stats: "Reading Stats are kept. The file stays on your device.",
    });
  });

  it("uses the singular for one Bookmark, one Highlight, and one note", () => {
    expect(shelfRemovalCopy("en", "Dune", { bookmarks: 1, highlights: 1, notes: 1 })).toEqual({
      title: 'Remove "Dune" from the Shelf?',
      body: "Its 1 Bookmark and 1 Highlight (1 with note) are deleted too.",
      stats: "Reading Stats are kept. The file stays on your device.",
    });
  });

  it("keeps zero counts in the plural and leaves the note out", () => {
    expect(shelfRemovalCopy("en", "Dune", { bookmarks: 0, highlights: 0, notes: 0 })).toEqual({
      title: 'Remove "Dune" from the Shelf?',
      body: "Its 0 Bookmarks and 0 Highlights are deleted too.",
      stats: "Reading Stats are kept. The file stays on your device.",
    });
  });

  it("localizes the singular copy in Spanish", () => {
    expect(shelfRemovalCopy("es", "Dune", { bookmarks: 1, highlights: 1, notes: 1 })).toEqual({
      title: '¿Quitar "Dune" del estante?',
      body: "Se eliminan también: 1 marcador y 1 subrayado (1 con nota).",
      stats: "Se conservan las estadísticas de lectura. El archivo permanece en tu dispositivo.",
    });
  });

  it("uses the Spanish plural body with plural nouns", () => {
    expect(shelfRemovalCopy("es", "Dune", { bookmarks: 3, highlights: 12, notes: 5 })).toEqual({
      title: '¿Quitar "Dune" del estante?',
      body: "Se eliminan también: 3 marcadores y 12 subrayados (5 con notas).",
      stats: "Se conservan las estadísticas de lectura. El archivo permanece en tu dispositivo.",
    });
  });
});

describe("the Frame's copy of the Shelf defaults", () => {
  // The Frame bundle cannot import the Worker's shelf.ts, so it keeps its own
  // copy; a fresh Reader must draw the view the Worker stores.
  it("matches the Worker's default view and each sort's default direction", () => {
    expect(FRAME_DEFAULT_SHELF_VIEW).toEqual(DEFAULT_SHELF_VIEW);
    for (const sort of SHELF_SORTS) {
      expect(frameDefaultDescending(sort), sort).toBe(defaultDescending(sort));
    }
  });
});

describe("frameImportState()", () => {
  /** `emptyReport` from import.ts, inline: importing it pulls DOM code into this node test. */
  const emptyReport = (source: ImportSource, found: number): ImportReport => ({
    source,
    found,
    processed: 0,
    added: [],
    alreadyOnShelf: [],
    relinked: [],
    unreadable: [],
    collisions: [],
    duplicates: 0,
    cancelled: false,
  });
  const FINISHED = Date.UTC(2026, 10, 28, 14, 32);
  const clock = (language: string) =>
    new Intl.DateTimeFormat(language, { hour: "2-digit", minute: "2-digit" }).format(FINISHED);

  function report(overrides: Partial<ImportReport>): ImportReport {
    return { ...emptyReport({ kind: "folder", name: "Library" }, 312), ...overrides };
  }

  it("draws a running folder Import with its title, progress, and counts so far", () => {
    const state = frameImportState("en", {
      status: "running",
      report: report({
        processed: 128,
        added: Array.from({ length: 96 }, (_, i) => `book-${i}.epub`),
        alreadyOnShelf: Array.from({ length: 22 }, (_, i) => `old-${i}.epub`),
        relinked: ["a.pdf", "b.pdf", "c.pdf"],
        unreadable: [{ name: "locked.azw3", reason: "drm" }],
      }),
    });
    expect(state).toMatchObject({
      status: "running",
      source: "folder",
      title: 'Importing "Library"',
      processed: 128,
      found: 312,
      progressText: "128 of 312 files",
      countsText: "96 added · 22 already on Shelf · 3 relinked · 1 unreadable",
    });
    expect(state.report.subtitle).toBe('Folder "Library" and its subfolders · 312 files found');
  });

  it("leaves the counts that are still zero out, but always says how many were added", () => {
    const state = frameImportState("en", { status: "running", report: report({ processed: 1 }) });
    expect(state.countsText).toBe("0 added");
  });

  it("names picked files as such and says when the Import finished", () => {
    const state = frameImportState("en", {
      status: "done",
      report: {
        ...emptyReport({ kind: "files" }, 1),
        processed: 1,
        added: ["dune.epub"],
        finishedAt: FINISHED,
      },
    });
    expect(state.title).toBe("Imported files");
    expect(state.source).toBe("files");
    expect(state.report.subtitle).toBe(`Picked files · 1 file found · finished at ${clock("en")}`);
    expect(state.report.added).toEqual(["dune.epub"]);
  });

  it("titles a finished folder Import by the folder, and a cancelled one as cancelled", () => {
    const done = frameImportState("en", {
      status: "done",
      report: report({ processed: 312, finishedAt: FINISHED }),
    });
    expect(done.title).toBe('Imported "Library"');
    const cancelled = frameImportState("en", {
      status: "done",
      report: report({ processed: 40, cancelled: true, finishedAt: FINISHED }),
    });
    expect(cancelled.title).toBe("Import cancelled");
    expect(cancelled.report.subtitle).toBe(
      `Folder "Library" and its subfolders · 312 files found · cancelled at ${clock("en")}`
    );
  });

  it("localizes each unreadable reason and keeps file names as they are", () => {
    const state = frameImportState("en", {
      status: "done",
      report: report({
        unreadable: [
          { name: "locked.azw3", reason: "drm" },
          { name: "half.epub", reason: "corrupt" },
          { name: "notes.txt", reason: "unsupported" },
          { name: "odd.pdf", reason: "unreadable" },
        ],
        finishedAt: FINISHED,
      }),
    });
    expect(state.report.unreadable).toEqual([
      { name: "locked.azw3", reason: "Protected by DRM" },
      { name: "half.epub", reason: "Corrupt or incomplete file" },
      { name: "notes.txt", reason: "Not a format Reader opens" },
      { name: "odd.pdf", reason: "Reader could not read this file" },
    ]);
  });

  it("says how many duplicates were added once, and nothing when there were none", () => {
    const none = frameImportState("en", { status: "done", report: report({ finishedAt: 1 }) });
    expect(none.report.duplicatesText).toBe("");
    const one = frameImportState("en", { status: "done", report: report({ duplicates: 1 }) });
    expect(one.report.duplicatesText).toBe("1 duplicate file inside the folder was added once.");
    const three = frameImportState("en", { status: "done", report: report({ duplicates: 3 }) });
    expect(three.report.duplicatesText).toBe(
      "3 duplicate files inside the folder were added once."
    );
    const files = frameImportState("en", {
      status: "done",
      report: { ...emptyReport({ kind: "files" }, 4), duplicates: 2 },
    });
    expect(files.report.duplicatesText).toBe("2 duplicate files were added once.");
  });

  it("speaks Spanish when the host does", () => {
    const state = frameImportState("es-ES", {
      status: "running",
      report: report({
        processed: 2,
        added: ["a.epub"],
        unreadable: [{ name: "x", reason: "drm" }],
      }),
    });
    expect(state.title).toBe("Importando «Library»");
    expect(state.progressText).toBe("2 de 312 archivos");
    expect(state.countsText).toBe("1 añadido · 1 ilegible");
  });

  it("hands the Frame a copy: a later file never changes a state already sent", () => {
    const live = report({ added: ["a.epub"] });
    const state = frameImportState("en", { status: "running", report: live });
    live.added.push("b.epub");
    expect(state.report.added).toEqual(["a.epub"]);
  });

  describe("collisions (#949)", () => {
    const MB = 1024 * 1024;
    /** A done report with one collision: the existing Document, and the new file that matches it. */
    function collisionReport(existing: Partial<CollidingDocument> = {}): ImportReport {
      return report({
        collisions: [
          {
            id: "collision-1",
            file: { grant: "g", name: "middlemarch-illustrated.epub", size: 2.4 * MB },
            fingerprint: "fingerprint-new",
            format: "epub",
            title: "Middlemarch",
            author: "George Eliot",
            existing: {
              id: "d1",
              title: "Middlemarch",
              author: "George Eliot",
              format: "epub",
              size: 1.8 * MB,
              progress: { page: 34, pageCount: 100 },
              openedAt: 5,
              removal: { bookmarks: 2, highlights: 7, notes: 0 },
              ...existing,
            },
          },
        ],
      });
    }

    it("describes the existing Document, the new file, and what Replace drops", () => {
      const state = frameImportState("en", {
        status: "done",
        report: collisionReport(),
      });
      const [collision] = state.report.collisions;
      expect(collision).toMatchObject({
        id: "collision-1",
        title: "Middlemarch",
        author: "George Eliot",
        fileName: "middlemarch-illustrated.epub",
        existingText: "EPUB · 1.8 MB · read 34%",
        newText: "EPUB · 2.4 MB",
        replaceWarning:
          "Replace drops the Reading Position (34%), 2 Bookmarks and 7 Highlights. Its Collections carry over.",
        choiceLabel: "Choice for Middlemarch",
      });
      expect(state.countsText).toContain("1 collision");
    });

    it("speaks Spanish with a decimal comma and a no-break space before the percent", () => {
      const state = frameImportState("es", { status: "done", report: collisionReport() });
      expect(state.report.collisions[0].existingText).toBe("EPUB · 1,8 MB · leído 34 %");
    });

    it("says a never-opened Document is New, and that Replace drops nothing", () => {
      const state = frameImportState("en", {
        status: "done",
        report: collisionReport({
          progress: null,
          openedAt: undefined,
          removal: { bookmarks: 0, highlights: 0, notes: 0 },
        }),
      });
      const [collision] = state.report.collisions;
      expect(collision.existingText.endsWith(" · New")).toBe(true);
      expect(collision.replaceWarning).toBe(
        "Replace drops no Reading Position, Bookmarks or Highlights; it has none. Its Collections carry over."
      );
    });

    it("names the Collection the added Documents were filed in, and says nothing without one", () => {
      const filed = frameImportState("en", {
        status: "done",
        report: report({ collection: "Library" }),
      });
      expect(filed.report.collectionText).toBe(
        'Added Documents are already on the Shelf in the Collection "Library".'
      );
      const unfiled = frameImportState("en", { status: "done", report: report({}) });
      expect(unfiled.report.collectionText).toBe("");
    });
  });
});
