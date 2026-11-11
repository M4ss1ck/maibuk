/**
 * The Plugin API's PDF Fonts rows (#751, slice 3): `fonts.list` names the fonts
 * the author installed for the PDF export, in catalog order, and `fonts.read`
 * hands back one's regular style bytes. Both run through the same device folder
 * and install marker the PDF Fonts feature and the export read, so a font that
 * is not installed here is not installed for a Plugin either.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import type { DownloadedFiles, PinnedFile } from "@/lib/verified-download";

const { mockGetPdfFontFiles } = vi.hoisted(() => ({ mockGetPdfFontFiles: vi.fn() }));

vi.mock("@/lib/db", () => ({ getDatabase: vi.fn() }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  getPdfFontFiles: mockGetPdfFontFiles,
}));

const { createPluginHandlers } = await import("@/features/plugins/handlers");
const { pdfFontFor } = await import("@/features/pdf-fonts/catalog");
const { PLUGIN_MANIFEST } = await import("@/test/support/plugin-fixtures");

const context = { pluginId: "tracer" };

const REGULAR = new TextEncoder().encode("REGULAR");
const BOLD = new TextEncoder().encode("BOLD");
const regularSha = await computeChecksum(REGULAR);
const boldSha = await computeChecksum(BOLD);

const latinEntry = pdfFontFor("latin");
const cjkEntry = pdfFontFor("cjk");
if (!latinEntry || !cjkEntry) throw new Error("the catalog is missing a PDF Font");
const latin = latinEntry;
const cjk = cjkEntry;
const originalLatin = { ...latin.files };
const originalCjk = { ...cjk.files };

/** A device folder of PDF Font files, keyed `<fontId>/<fileName>`. */
let store: Map<string, Uint8Array>;

function fileName(file: PinnedFile): string {
  return file.url.slice(file.url.lastIndexOf("/") + 1);
}

/** The device folder the platform adapter serves, over `store`. */
function memoryFiles(): DownloadedFiles {
  return {
    read: async (id, name) => store.get(`${id}/${name}`) ?? null,
    write: async (id, name, data) => {
      store.set(`${id}/${name}`, data);
    },
    remove: async (id) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${id}/`)) store.delete(key);
      }
    },
  };
}

/** Writes one font's styles and its pin marker, as a finished install leaves them. */
function install(font: typeof latin): void {
  store.set(`${font.id}/${fileName(font.files.regular)}`, REGULAR);
  store.set(`${font.id}/${fileName(font.files.bold)}`, BOLD);
  store.set(`${font.id}/pin`, new TextEncoder().encode(`${regularSha}:${boldSha}`));
}

function fontsRows() {
  const handlers = createPluginHandlers(PLUGIN_MANIFEST);
  const list = handlers["fonts.list"];
  const read = handlers["fonts.read"];
  if (!list || !read) throw new Error("the fonts rows are not wired");
  return { list, read };
}

beforeEach(() => {
  // The two pinned families with small stand-in files, as the pdf-fonts tests do.
  latin.files = {
    regular: { ...originalLatin.regular, bytes: REGULAR.length, sha256: regularSha },
    bold: { ...originalLatin.bold, bytes: BOLD.length, sha256: boldSha },
  };
  cjk.files = {
    regular: { ...originalCjk.regular, bytes: REGULAR.length, sha256: regularSha },
    bold: { ...originalCjk.bold, bytes: BOLD.length, sha256: boldSha },
  };
  store = new Map();
  mockGetPdfFontFiles.mockResolvedValue(memoryFiles());
});

afterEach(() => {
  latin.files = originalLatin;
  cjk.files = originalCjk;
  mockGetPdfFontFiles.mockReset();
});

describe("fonts.list", () => {
  it("lists nothing on a device with no PDF Font installed", async () => {
    const { list } = fontsRows();

    await expect(list({}, context)).resolves.toEqual([]);
  });

  it("lists the PDF Fonts installed on this device in catalog order", async () => {
    install(cjk);
    install(latin);
    const { list } = fontsRows();

    await expect(list({}, context)).resolves.toEqual([
      { id: "latin", family: "Noto Serif" },
      { id: "cjk", family: "Noto Serif CJK" },
    ]);
  });

  it("leaves out a font whose install marker is not on the device", async () => {
    install(latin);
    install(cjk);
    store.delete("latin/pin");
    const { list } = fontsRows();

    await expect(list({}, context)).resolves.toEqual([{ id: "cjk", family: "Noto Serif CJK" }]);
  });
});

describe("fonts.read", () => {
  it("reads an installed font's regular style file as bytes", async () => {
    install(latin);
    const { read } = fontsRows();

    const bytes = await read({ id: "latin" }, context);

    // jsdom's globals and Node's TextEncoder differ by realm, so compare the
    // bytes themselves rather than the constructor they came from.
    expect(Array.from(bytes)).toEqual(Array.from(REGULAR));
    expect(new TextDecoder().decode(bytes)).toBe("REGULAR");
  });

  it("refuses an id the catalog does not hold and one this device does not have", async () => {
    install(latin);
    const { read } = fontsRows();

    for (const id of ["nonsense", "cjk"]) {
      await expect(read({ id }, context)).rejects.toMatchObject({
        name: "PluginApiError",
        code: "invalid-params",
      });
    }
  });

  it("refuses a font whose style file no longer matches its pin", async () => {
    install(latin);
    store.set(`latin/${fileName(latin.files.bold)}`, new Uint8Array(1));
    const { read } = fontsRows();

    await expect(read({ id: "latin" }, context)).rejects.toMatchObject({
      name: "PluginApiError",
      code: "invalid-params",
    });
  });
});
