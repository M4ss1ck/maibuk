import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeChecksum } from "@/lib/checksum";
import type { DownloadedFiles } from "@/lib/verified-download";

const { mockGetFiles } = vi.hoisted(() => ({ mockGetFiles: vi.fn() }));
vi.mock("@/lib/platform", () => ({ getSpellCheckDictionaryFiles: mockGetFiles }));

const { dictionaryFor } = await import("@/features/spell-check-dictionaries/catalog");
const { dictionaryStatus, useSpellCheckDictionaries } = await import(
  "@/features/spell-check-dictionaries/store"
);

const AFF = new TextEncoder().encode("AFF");
const DIC = new TextEncoder().encode("DIC");
const affSha256 = await computeChecksum(AFF);
const dicSha256 = await computeChecksum(DIC);

const fr = dictionaryFor("fr");
if (!fr) throw new Error("the catalog has no French entry");

const originalAff = { ...fr.aff };
const originalDic = { ...fr.dic };

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

function serveCorrect() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === fr?.aff.url) return new Response(AFF);
      if (url === fr?.dic.url) return new Response(DIC);
      return new Response(null, { status: 404 });
    })
  );
}

let files: DownloadedFiles;
let store: Map<string, Uint8Array>;

beforeEach(() => {
  fr.aff = { ...originalAff, bytes: AFF.length, sha256: affSha256 };
  fr.dic = { ...originalDic, bytes: DIC.length, sha256: dicSha256 };
  ({ store, files } = memoryFiles());
  mockGetFiles.mockResolvedValue(files);
  useSpellCheckDictionaries.setState({
    installed: [],
    downloading: [],
    failed: [],
    loaded: false,
  });
  serveCorrect();
});

afterEach(() => {
  fr.aff = originalAff;
  fr.dic = originalDic;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSpellCheckDictionaries", () => {
  it("adds a language to installed after a successful download", async () => {
    await useSpellCheckDictionaries.getState().download("fr");

    expect(useSpellCheckDictionaries.getState().installed).toContain("fr");
    expect(useSpellCheckDictionaries.getState().failed).not.toContain("fr");
    expect(new TextDecoder().decode(store.get("fr/index.aff"))).toBe("AFF");
  });

  it("adds a language to failed and not installed when the download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 }))
    );

    await useSpellCheckDictionaries.getState().download("fr");

    expect(useSpellCheckDictionaries.getState().failed).toContain("fr");
    expect(useSpellCheckDictionaries.getState().installed).not.toContain("fr");
  });

  it("empties installed and the device folder on remove", async () => {
    useSpellCheckDictionaries.setState({ installed: ["fr"], failed: ["fr"] });

    await useSpellCheckDictionaries.getState().remove("fr");

    expect(useSpellCheckDictionaries.getState().installed).toEqual([]);
    expect(useSpellCheckDictionaries.getState().failed).toEqual([]);
    expect(files.remove).toHaveBeenCalledWith("fr");
  });
});

describe("useSpellCheckDictionaries remove during a download", () => {
  it("leaves the download alone, so its marker cannot outlive the removed files", async () => {
    useSpellCheckDictionaries.setState({ downloading: ["fr"] });

    await useSpellCheckDictionaries.getState().remove("fr");

    expect(files.remove).not.toHaveBeenCalled();
  });
});

describe("dictionaryStatus()", () => {
  const none = { installed: [], downloading: [], failed: [] };

  it("reports a bundled language as ready", () => {
    expect(dictionaryStatus("es-MX", none).kind).toBe("ready");
  });

  it("reports a catalog language available when it is not installed", () => {
    expect(dictionaryStatus("fr", none)).toEqual({
      kind: "available",
      entry: fr,
      failed: false,
    });
  });

  it("reports a catalog language ready once installed", () => {
    expect(dictionaryStatus("fr", { ...none, installed: ["fr"] }).kind).toBe("ready");
  });

  it("reports a catalog language downloading while it downloads", () => {
    expect(dictionaryStatus("fr", { ...none, downloading: ["fr"] }).kind).toBe("downloading");
  });

  it("reports a language outside the catalog unavailable", () => {
    expect(dictionaryStatus("ja", none).kind).toBe("unavailable");
  });
});
