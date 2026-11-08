import { afterEach, describe, expect, it } from "vitest";
import {
  cleanSaveName,
  createMemoryPluginFileSaver,
  getPluginFileSaver,
  registerPluginFileSaver,
  saveNameError,
  savePluginFile,
} from "@/features/plugins/file-save";

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

describe("cleanSaveName()", () => {
  it("keeps a plain file name", () => {
    expect(cleanSaveName("chapter.txt")).toBe("chapter.txt");
  });

  it("drops everything before the last separator, POSIX and Windows", () => {
    expect(cleanSaveName("../../etc/report.pdf")).toBe("report.pdf");
    expect(cleanSaveName("C:\\Users\\author\\report.pdf")).toBe("report.pdf");
    expect(cleanSaveName("/home/author/map.png")).toBe("map.png");
    expect(cleanSaveName("maps\\2026\\map.png")).toBe("map.png");
  });

  it("removes control characters", () => {
    expect(cleanSaveName("map\u0000\u0007.png")).toBe("map.png");
    expect(cleanSaveName("line\nbreak.txt")).toBe("linebreak.txt");
  });

  it("strips leading dots so a save never writes a hidden file", () => {
    expect(cleanSaveName(".hidden.txt")).toBe("hidden.txt");
    expect(cleanSaveName("...dots.txt")).toBe("dots.txt");
  });

  it("trims surrounding whitespace", () => {
    expect(cleanSaveName("  report.pdf  ")).toBe("report.pdf");
  });

  it("leaves a name with no extension alone", () => {
    expect(cleanSaveName("README")).toBe("README");
  });

  it("returns an empty name when the input is only a path", () => {
    expect(cleanSaveName("../../")).toBe("");
    expect(cleanSaveName("")).toBe("");
  });

  it("caps a long name at 255 UTF-8 bytes, keeping the extension", () => {
    const capped = cleanSaveName(`${"a".repeat(400)}.txt`);

    expect(utf8Length(capped)).toBe(255);
    expect(capped.endsWith(".txt")).toBe(true);
    expect(capped.slice(0, -".txt".length)).toBe("a".repeat(251));
  });

  it("counts UTF-8 bytes and never splits a code point", () => {
    const accented = cleanSaveName(`${"é".repeat(200)}.txt`);
    expect(utf8Length(accented)).toBeLessThanOrEqual(255);
    expect(accented.endsWith(".txt")).toBe(true);
    // 125 two-byte code points fill 250 of the 251 bytes the stem may keep.
    expect(accented.slice(0, -".txt".length)).toBe("é".repeat(125));

    const emoji = cleanSaveName(`${"😀".repeat(80)}.png`);
    expect(utf8Length(emoji)).toBeLessThanOrEqual(255);
    expect(emoji.endsWith(".png")).toBe(true);
    // A surrogate pair is never cut in half, so every code point survives whole.
    expect(emoji).toBe(`${"😀".repeat(62)}.png`);
    expect(emoji).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("keeps a short name with a long extension unchanged", () => {
    expect(cleanSaveName("a.appimage")).toBe("a.appimage");
  });
});

describe("saveNameError()", () => {
  it("accepts a name with an ordinary extension", () => {
    expect(saveNameError("report.pdf")).toBeNull();
    expect(saveNameError("map.png")).toBeNull();
  });

  it("allows html and svg", () => {
    expect(saveNameError("page.html")).toBeNull();
    expect(saveNameError("drawing.svg")).toBeNull();
  });

  it("refuses a name with no extension", () => {
    expect(saveNameError("README")).toMatch(/extension/);
    expect(saveNameError("")).toMatch(/extension/);
    expect(saveNameError("archive.")).toMatch(/extension/);
    expect(saveNameError(".hidden")).toMatch(/extension/);
  });

  it("refuses every extension on the executable blocklist", () => {
    for (const extension of [
      "exe",
      "msi",
      "bat",
      "cmd",
      "com",
      "scr",
      "ps1",
      "sh",
      "app",
      "dmg",
      "pkg",
      "deb",
      "rpm",
      "AppImage",
      "desktop",
      "jar",
      "lnk",
    ]) {
      expect(saveNameError(`payload.${extension}`), extension).toMatch(/executable/);
    }
  });

  it("compares the extension case-insensitively", () => {
    expect(saveNameError("payload.EXE")).toMatch(/executable/);
    expect(saveNameError("payload.Bat")).toMatch(/executable/);
    expect(saveNameError("payload.appimage")).toMatch(/executable/);
  });
});

describe("savePluginFile()", () => {
  it("refuses not-implemented before validating the name when no saver is registered", async () => {
    await expect(
      savePluginFile(null, {
        name: "README",
        mimeType: "text/plain",
        blob: new Blob([new Uint8Array([1])]),
      })
    ).rejects.toMatchObject({ name: "PluginApiError", code: "not-implemented" });
  });
});

describe("the Plugin File Saver seam", () => {
  afterEach(() => {
    registerPluginFileSaver(null);
  });

  it("registers the saver the handlers read, and clears it", () => {
    expect(getPluginFileSaver()).toBeNull();
    const saver = createMemoryPluginFileSaver();
    registerPluginFileSaver(saver);
    expect(getPluginFileSaver()).toBe(saver);
    registerPluginFileSaver(null);
    expect(getPluginFileSaver()).toBeNull();
  });

  it("records a save with its name, MIME type, and bytes", async () => {
    const saver = createMemoryPluginFileSaver();
    const bytes = new Uint8Array([1, 2, 3]);

    await expect(saver.save("a.txt", "text/plain", new Blob([bytes]))).resolves.toBe("saved");

    expect(saver.saves).toHaveLength(1);
    expect(saver.saves[0].name).toBe("a.txt");
    expect(saver.saves[0].mimeType).toBe("text/plain");
    expect([...saver.saves[0].bytes]).toEqual([1, 2, 3]);
  });

  it("queues a cancel: the next save is cancelled and records nothing", async () => {
    const saver = createMemoryPluginFileSaver();
    saver.queueCancel();

    await expect(saver.save("a.txt", "text/plain", new Blob([new Uint8Array([1])]))).resolves.toBe(
      "cancelled"
    );
    expect(saver.saves).toEqual([]);

    await expect(saver.save("b.txt", "text/plain", new Blob([new Uint8Array([1])]))).resolves.toBe(
      "saved"
    );
    expect(saver.saves.map((save) => save.name)).toEqual(["b.txt"]);
  });
});
