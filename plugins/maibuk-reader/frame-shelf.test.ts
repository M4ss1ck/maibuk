/**
 * The Shelf's Frame view model (#944): the wire-safe rows the Frame draws, the
 * localized copy around them, and the stable tone a generated cover takes.
 * The File Grant and Fingerprint never leave the Worker, so every row here is
 * checked for their absence as well as for its progress and status lines.
 */

import { describe, expect, it } from "vitest";
import {
  frameShelfEntry,
  frameShelfLabels,
  frameShelfState,
  shelfRemovalCopy,
  shelfTone,
} from "./frame-shelf";
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
    });
    expect(mapped).not.toHaveProperty("grant");
    expect(mapped).not.toHaveProperty("fingerprint");
    expect(JSON.stringify(mapped)).not.toContain("grant-secret");
    expect(JSON.stringify(mapped)).not.toContain("fp-secret");
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
