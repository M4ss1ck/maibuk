import { describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import {
  installDictionary,
  isDictionaryInstalled,
  readInstalledDictionary,
} from "@/features/spell-check-dictionaries/install";
import type { DownloadedFiles } from "@/lib/verified-download";
import type { SpellCheckDictionary } from "@/features/spell-check-dictionaries/types";

const AFF = new TextEncoder().encode("AFF");
const DIC = new TextEncoder().encode("DIC");
const affSha256 = await computeChecksum(AFF);
const dicSha256 = await computeChecksum(DIC);

function makeEntry(overrides: Partial<SpellCheckDictionary> = {}): SpellCheckDictionary {
  return {
    language: "fr",
    script: "Latin",
    aff: {
      url: "https://raw.githubusercontent.com/wooorm/dictionaries/deadbeef/dictionaries/fr/index.aff",
      bytes: AFF.length,
      sha256: affSha256,
    },
    dic: {
      url: "https://raw.githubusercontent.com/wooorm/dictionaries/deadbeef/dictionaries/fr/index.dic",
      bytes: DIC.length,
      sha256: dicSha256,
    },
    license: "MPL-2.0",
    source: "https://github.com/wooorm/dictionaries/tree/deadbeef/dictionaries/fr",
    ...overrides,
  };
}

function memoryFiles() {
  const store = new Map<string, Uint8Array>();
  const files: DownloadedFiles = {
    read: vi.fn(async (language, name) => store.get(`${language}/${name}`) ?? null),
    write: vi.fn(async (language, name, data) => {
      store.set(`${language}/${name}`, data);
    }),
    remove: vi.fn(async (language) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${language}/`)) store.delete(key);
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

const entry = makeEntry();
const goodFetch = () =>
  serve({
    [entry.aff.url]: AFF,
    [entry.dic.url]: DIC,
  });

describe("installDictionary()", () => {
  it("installs both files and a matching marker", async () => {
    const { store, files } = memoryFiles();

    await installDictionary(entry, files, goodFetch());

    expect(new TextDecoder().decode(store.get("fr/index.aff"))).toBe("AFF");
    expect(new TextDecoder().decode(store.get("fr/index.dic"))).toBe("DIC");
    expect(new TextDecoder().decode(store.get("fr/pin"))).toBe(`${affSha256}:${dicSha256}`);
    expect(await isDictionaryInstalled(entry, files)).toBe(true);
  });

  it("writes nothing when a file's size does not match", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({
      [entry.aff.url]: new TextEncoder().encode("AFF!"),
      [entry.dic.url]: DIC,
    });

    await expect(installDictionary(entry, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("writes nothing when a file's sha256 does not match", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({
      [entry.aff.url]: new TextEncoder().encode("XXX"),
      [entry.dic.url]: DIC,
    });

    await expect(installDictionary(entry, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("writes nothing when the response is not ok", async () => {
    const { files } = memoryFiles();
    const fetchFile = serve({ [entry.aff.url]: 404, [entry.dic.url]: DIC });

    await expect(installDictionary(entry, files, fetchFile)).rejects.toBeTruthy();
    expect(files.write).not.toHaveBeenCalled();
  });

  it("removes the folder and leaves no marker when a write fails", async () => {
    const { store, files } = memoryFiles();
    const write = files.write as ReturnType<typeof vi.fn>;
    write.mockImplementationOnce(async () => undefined);
    write.mockImplementationOnce(async () => {
      throw new Error("disk full");
    });

    await expect(installDictionary(entry, files, goodFetch())).rejects.toThrow("disk full");
    expect(files.remove).toHaveBeenCalledWith("fr");
    expect(store.size).toBe(0);
  });
});

describe("readInstalledDictionary()", () => {
  it("returns the installed bytes and nothing after remove", async () => {
    const { store, files } = memoryFiles();
    await installDictionary(entry, files, goodFetch());

    const installed = await readInstalledDictionary(entry, files);
    expect(new TextDecoder().decode(installed?.aff)).toBe("AFF");
    expect(new TextDecoder().decode(installed?.dic)).toBe("DIC");

    await files.remove("fr");
    expect(await readInstalledDictionary(entry, files)).toBeNull();
    expect([...store.keys()].some((key) => key.startsWith("fr/"))).toBe(false);
  });

  it("reads as not installed after the entry is re-pinned", async () => {
    const { files } = memoryFiles();
    await installDictionary(entry, files, goodFetch());

    const repinned = makeEntry({
      aff: { ...entry.aff, sha256: "0".repeat(64) },
    });
    expect(await readInstalledDictionary(repinned, files)).toBeNull();
    expect(await isDictionaryInstalled(repinned, files)).toBe(false);
  });
});

describe("isDictionaryInstalled()", () => {
  it("is false with no marker", async () => {
    const { files } = memoryFiles();
    expect(await isDictionaryInstalled(entry, files)).toBe(false);
  });
});
