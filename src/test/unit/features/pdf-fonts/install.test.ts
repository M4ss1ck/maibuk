import { describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import {
  installPdfFont,
  isPdfFontInstalled,
  readInstalledPdfFont,
} from "@/features/pdf-fonts/install";
import type { PdfFont } from "@/features/pdf-fonts/types";
import type { DownloadedFiles } from "@/lib/verified-download";

const REGULAR = new TextEncoder().encode("REGULAR");
const BOLD = new TextEncoder().encode("BOLD");
const regularSha = await computeChecksum(REGULAR);
const boldSha = await computeChecksum(BOLD);

function makeFont(overrides: Partial<PdfFont> = {}): PdfFont {
  return {
    id: "latin",
    family: "Noto Serif",
    files: {
      regular: {
        url: "https://raw.githubusercontent.com/notofonts/notofonts.github.io/deadbeef/fonts/NotoSerif-Regular.ttf",
        bytes: REGULAR.length,
        sha256: regularSha,
      },
      bold: {
        url: "https://raw.githubusercontent.com/notofonts/notofonts.github.io/deadbeef/fonts/NotoSerif-Bold.ttf",
        bytes: BOLD.length,
        sha256: boldSha,
      },
    },
    coverage: "20-7e",
    license: "OFL-1.1",
    source: "https://github.com/notofonts/notofonts.github.io/tree/deadbeef/fonts/NotoSerif",
    ...overrides,
  };
}

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

function serve(bodies: Record<string, Uint8Array | number>) {
  return vi.fn(async (url: string) => {
    const body = bodies[url];
    if (typeof body === "number") return new Response(null, { status: body });
    return new Response(new Uint8Array(body));
  });
}

const font = makeFont();
const goodFetch = () =>
  serve({
    [font.files.regular.url]: REGULAR,
    [font.files.bold.url]: BOLD,
  });

describe("installPdfFont()", () => {
  it("installs every style and a matching marker", async () => {
    const { store, files } = memoryFiles();

    await installPdfFont(font, files, goodFetch());

    expect(new TextDecoder().decode(store.get("latin/NotoSerif-Regular.ttf"))).toBe("REGULAR");
    expect(new TextDecoder().decode(store.get("latin/NotoSerif-Bold.ttf"))).toBe("BOLD");
    expect(new TextDecoder().decode(store.get("latin/pin"))).toBe(`${regularSha}:${boldSha}`);
    expect(await isPdfFontInstalled(font, files)).toBe(true);
  });

  it("writes nothing when a file's size does not match", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({
      [font.files.regular.url]: new TextEncoder().encode("REGULAR!"),
      [font.files.bold.url]: BOLD,
    });

    await expect(installPdfFont(font, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("writes nothing when a file's sha256 does not match", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({
      [font.files.regular.url]: new TextEncoder().encode("XXX"),
      [font.files.bold.url]: BOLD,
    });

    await expect(installPdfFont(font, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("writes nothing when the response is not ok", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({ [font.files.regular.url]: 404, [font.files.bold.url]: BOLD });

    await expect(installPdfFont(font, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("removes the folder and leaves no marker when a write fails", async () => {
    const { store, files } = memoryFiles();
    const write = files.write as ReturnType<typeof vi.fn>;
    write.mockImplementationOnce(async () => undefined);
    write.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await expect(installPdfFont(font, files, goodFetch())).rejects.toThrow("disk full");
    expect(files.remove).toHaveBeenCalledWith("latin");
    expect(store.size).toBe(0);
  });
});

describe("readInstalledPdfFont()", () => {
  it("returns the installed bytes and nothing after remove", async () => {
    const { store, files } = memoryFiles();
    await installPdfFont(font, files, goodFetch());

    const installed = await readInstalledPdfFont(font, files);
    expect(new TextDecoder().decode(installed?.regular)).toBe("REGULAR");
    expect(new TextDecoder().decode(installed?.bold)).toBe("BOLD");

    await files.remove("latin");
    expect(await readInstalledPdfFont(font, files)).toBeNull();
    expect([...store.keys()].some((key) => key.startsWith("latin/"))).toBe(false);
  });

  it("reads as not installed after the font is re-pinned", async () => {
    const { files } = memoryFiles();
    await installPdfFont(font, files, goodFetch());

    const repinned = makeFont({
      files: { ...font.files, bold: { ...font.files.bold, sha256: "0".repeat(64) } },
    });
    expect(await readInstalledPdfFont(repinned, files)).toBeNull();
    expect(await isPdfFontInstalled(repinned, files)).toBe(false);
  });
});

describe("isPdfFontInstalled()", () => {
  it("is false with no marker", async () => {
    const { files } = memoryFiles();
    expect(await isPdfFontInstalled(font, files)).toBe(false);
  });
});
