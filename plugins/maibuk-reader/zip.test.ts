/**
 * The zip reader the Reader Worker runs for EPUB and CBZ files (#653): it reads
 * only the end-of-central-directory record and the central directory to open an
 * archive, inflates one entry at a time, refuses a DRM-protected EPUB, and maps
 * every failure to a `ZipError` code the Frame already knows how to report.
 * The tests drive it with an in-memory ranged read, never a real file.
 */

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { ZipError, openZip, protectsContent, type RangedRead } from "./zip";

/** A ranged read over `bytes`, recording what each call asked for. */
function reader(bytes: Uint8Array): { read: RangedRead; calls: [number, number][] } {
  const calls: [number, number][] = [];
  return {
    calls,
    read: async (offset, length) => {
      calls.push([offset, length]);
      return bytes.subarray(offset, offset + length);
    },
  };
}

/** A zip whose entries `zipSync` stores and deflates the way a real one does. */
function archive(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) entries[name] = strToU8(value);
  return zipSync(entries);
}

/** The offset of the end-of-central-directory record in `bytes`. */
function eocdOffset(bytes: Uint8Array): number {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("no end-of-central-directory record");
}

const UTF8 = new TextDecoder("utf-8");

describe("opening an archive", () => {
  it("lists stored and deflated entries and reads one on demand", async () => {
    const bytes = zipSync({
      "META-INF/container.xml": strToU8("<container/>"),
      "OEBPS/chapter1.xhtml": strToU8("<html><body>spice</body></html>"),
    });
    const opened = await openZip(reader(bytes).read, bytes.length);
    expect(opened.entries.map((entry) => entry.name)).toEqual([
      "META-INF/container.xml",
      "OEBPS/chapter1.xhtml",
    ]);
    expect(UTF8.decode(await opened.read("META-INF/container.xml"))).toBe("<container/>");
    expect(await opened.readText("OEBPS/chapter1.xhtml")).toContain("spice");
  });

  it("reads the tail and the directory, never the whole file", async () => {
    const bytes = zipSync(
      {
        "OEBPS/large.bin": new Uint8Array(200_000).fill(7),
        "OEBPS/small.txt": strToU8("small"),
      },
      { level: 0 }
    );
    const { read, calls } = reader(bytes);
    await openZip(read, bytes.length);
    expect(calls[0][1]).toBeLessThan(bytes.length);
    expect(calls[0][0]).toBeGreaterThan(0);
    for (const [offset, length] of calls) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset + length).toBeLessThanOrEqual(bytes.length);
    }
    expect(calls.every(([, length]) => length <= 0xffff + 22)).toBe(true);
  });

  it("reports a missing entry as `missing`, and `readText` as null", async () => {
    const bytes = archive({ "a.txt": "a" });
    const opened = await openZip(reader(bytes).read, bytes.length);
    await expect(opened.read("b.txt")).rejects.toMatchObject({ code: "missing" });
    expect(await opened.readText("b.txt")).toBeNull();
  });
});

describe("refusing a damaged archive", () => {
  it("refuses bytes too small to hold a zip", async () => {
    const bytes = new Uint8Array(8);
    await expect(openZip(reader(bytes).read, bytes.length)).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it("refuses bytes with no directory", async () => {
    const bytes = strToU8("this is not a zip archive at all");
    await expect(openZip(reader(bytes).read, bytes.length)).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it("refuses a directory whose signature is wrong", async () => {
    const bytes = archive({ "a.txt": "hello" });
    const eocd = eocdOffset(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const directoryOffset = view.getUint32(eocd + 16, true);
    bytes[directoryOffset] = 0x00;
    await expect(openZip(reader(bytes).read, bytes.length)).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it("refuses a zip64 archive Reader does not read", async () => {
    const bytes = archive({ "a.txt": "hello" });
    const eocd = eocdOffset(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint16(eocd + 10, 0xffff, true);
    await expect(openZip(reader(bytes).read, bytes.length)).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it("refuses an archive whose directory is cut off", async () => {
    const bytes = archive({ "a.txt": "a".repeat(500) });
    const truncated = bytes.subarray(0, bytes.length - 60);
    await expect(openZip(reader(truncated).read, truncated.length)).rejects.toMatchObject({
      code: "corrupt",
    });
  });
});

describe("DRM", () => {
  it("still opens an archive that obfuscates only fonts", async () => {
    const bytes = archive({
      "META-INF/encryption.xml": `<encryption><EncryptedData>
        <CipherData><CipherReference URI="OEBPS/fonts/book.otf"/></CipherData>
      </EncryptedData></encryption>`,
      "OEBPS/chapter1.xhtml": "<html/>",
    });
    const opened = await openZip(reader(bytes).read, bytes.length);
    expect(opened.entries.map((entry) => entry.name)).toContain("OEBPS/chapter1.xhtml");
  });

  it("refuses an archive that encrypts its content", async () => {
    const bytes = archive({
      "META-INF/encryption.xml": `<encryption><EncryptedData>
        <CipherData><CipherReference URI="OEBPS/chapter1.xhtml"/></CipherData>
      </EncryptedData></encryption>`,
      "OEBPS/chapter1.xhtml": "<html/>",
    });
    await expect(openZip(reader(bytes).read, bytes.length)).rejects.toMatchObject({
      code: "drm",
    });
  });

  it("decides from the encryption document alone", () => {
    expect(protectsContent("<encryption/>")).toBe(false);
    expect(protectsContent(`<EncryptedData><CipherReference URI="a.woff2"/></EncryptedData>`)).toBe(
      false
    );
    expect(
      protectsContent(`<EncryptedData><CipherReference URI="chapter.xhtml"/></EncryptedData>`)
    ).toBe(true);
    expect(protectsContent(`<EncryptedData/>`)).toBe(true);
  });
});

describe("ZipError", () => {
  it("carries the code the Frame reports", () => {
    const error = new ZipError("drm", "protected");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ZipError");
    expect(error.code).toBe("drm");
  });
});
