import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import type { DownloadedFiles } from "@/lib/verified-download";

const { mockGetFiles } = vi.hoisted(() => ({ mockGetFiles: vi.fn() }));
vi.mock("@/lib/platform", () => ({ getPdfFontFiles: mockGetFiles }));

const { pdfFontFor } = await import("@/features/pdf-fonts/catalog");
const { usePdfFonts } = await import("@/features/pdf-fonts/store");

const REGULAR = new TextEncoder().encode("REGULAR");
const BOLD = new TextEncoder().encode("BOLD");
const regularSha = await computeChecksum(REGULAR);
const boldSha = await computeChecksum(BOLD);

const latinEntry = pdfFontFor("latin");
if (!latinEntry) throw new Error("the catalog has no Latin font");
const latin = latinEntry;

const originalFiles = { ...latin.files };

function memoryFiles() {
  const store = new Map<string, Uint8Array>();
  const files: DownloadedFiles = {
    read: vi.fn(async (id, name) => store.get(`${id}/${name}`) ?? null),
    write: vi.fn(async (id, name, data) => {
      store.set(`${id}/${name}`, data);
    }),
    remove: vi.fn(async (id) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${id}/`)) store.delete(key);
      }
    }),
  };
  return { store, files };
}

function serveCorrect() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === latin.files.regular.url) return new Response(REGULAR);
      if (url === latin.files.bold.url) return new Response(BOLD);
      return new Response(null, { status: 404 });
    })
  );
}

let files: DownloadedFiles;
let store: Map<string, Uint8Array>;

beforeEach(() => {
  latin.files = {
    regular: { ...originalFiles.regular, bytes: REGULAR.length, sha256: regularSha },
    bold: { ...originalFiles.bold, bytes: BOLD.length, sha256: boldSha },
  };
  ({ store, files } = memoryFiles());
  mockGetFiles.mockResolvedValue(files);
  usePdfFonts.setState({ installed: [], downloading: [], failed: [], loaded: false });
  serveCorrect();
});

afterEach(() => {
  latin.files = originalFiles;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("usePdfFonts", () => {
  it("adds a font to installed after a successful download", async () => {
    await usePdfFonts.getState().download("latin");

    expect(usePdfFonts.getState().installed).toContain("latin");
    expect(usePdfFonts.getState().failed).not.toContain("latin");
    expect(new TextDecoder().decode(store.get("latin/NotoSerif-Regular.ttf"))).toBe("REGULAR");
  });

  it("adds a font to failed and not installed when the download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );

    await usePdfFonts.getState().download("latin");

    expect(usePdfFonts.getState().failed).toContain("latin");
    expect(usePdfFonts.getState().installed).not.toContain("latin");
  });

  it("empties installed and the device folder on remove", async () => {
    usePdfFonts.setState({ installed: ["latin"], failed: ["latin"] });

    await usePdfFonts.getState().remove("latin");

    expect(usePdfFonts.getState().installed).toEqual([]);
    expect(usePdfFonts.getState().failed).toEqual([]);
    expect(files.remove).toHaveBeenCalledWith("latin");
  });

  it("refreshes installed from the device", async () => {
    store.set("latin/pin", new TextEncoder().encode(`${regularSha}:${boldSha}`));

    await usePdfFonts.getState().refresh();

    expect(usePdfFonts.getState().installed).toEqual(["latin"]);
    expect(usePdfFonts.getState().loaded).toBe(true);
  });
});

describe("usePdfFonts remove during a download", () => {
  it("leaves the download alone, so its marker cannot outlive the removed files", async () => {
    usePdfFonts.setState({ downloading: ["latin"] });

    await usePdfFonts.getState().remove("latin");

    expect(files.remove).not.toHaveBeenCalled();
  });
});
