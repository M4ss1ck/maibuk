import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, modelsFor, validateCatalog } from "@/features/dictation/catalog";
import type { ModelSpec } from "@/features/dictation/types";

const fixture: ModelSpec = {
  id: "fake-tiny-pt-1",
  name: "Fake Tiny",
  engine: "moonshine",
  languages: ["en"],
  tier: "fast",
  platforms: ["web"],
  files: [
    {
      name: "a.bin",
      url: "https://example.test/a.bin",
      bytes: 9,
      checksum: { algo: "crc32c", value: "4waSgw==" },
    },
  ],
  engineOptions: {},
  capabilities: { casing: true, punctuation: true, streaming: true },
  source: "https://example.test/fake",
};

describe("MODEL_CATALOG", () => {
  it("is valid", () => {
    expect(validateCatalog(MODEL_CATALOG)).toEqual([]);
  });

  it("offers Fast and Accurate in English and Spanish on web and Linux", () => {
    for (const platform of ["web", "tauri-linux"] as const) {
      const pairs = modelsFor(MODEL_CATALOG, platform)
        .filter((m) => m.engine === "moonshine")
        .map((m) => `${m.languages[0]}-${m.tier}`);
      expect(pairs.sort()).toEqual(["en-accurate", "en-fast", "es-accurate", "es-fast"]);
    }
  });

  it("names every model and links its https source", () => {
    for (const m of MODEL_CATALOG) {
      expect(m.name.trim(), m.id).not.toBe("");
      expect(m.source.startsWith("https://"), m.id).toBe(true);
    }
  });

  it("marks Spanish Moonshine models as uncased and unpunctuated", () => {
    const es = MODEL_CATALOG.filter((m) => m.engine === "moonshine" && m.languages.includes("es"));
    expect(es.length).toBeGreaterThan(0);
    expect(es.every((m) => !m.capabilities.casing && !m.capabilities.punctuation)).toBe(true);
  });

  it("sets the 0.2 s transcription interval on every Moonshine model", () => {
    const moonshine = MODEL_CATALOG.filter((m) => m.engine === "moonshine");
    expect(moonshine.every((m) => m.engineOptions.transcription_interval === "0.2")).toBe(true);
  });

  it("ships the sherpa-onnx models for Linux only, in English and Spanish", () => {
    const sherpa = MODEL_CATALOG.filter((m) => m.engine === "sherpa");
    expect(sherpa.map((m) => m.name).sort()).toEqual([
      "Canary 180M Flash",
      "Nemotron 3.5 Streaming",
    ]);
    for (const m of sherpa) {
      expect(m.platforms, m.id).toEqual(["tauri-linux"]);
      expect(m.languages, m.id).toEqual(["en", "es"]);
    }
  });

  it("marks Canary as offline and Nemotron as streaming", () => {
    const canary = MODEL_CATALOG.find((m) => m.name === "Canary 180M Flash");
    const nemotron = MODEL_CATALOG.find((m) => m.name === "Nemotron 3.5 Streaming");
    expect(canary?.capabilities.streaming).toBe(false);
    expect(nemotron?.capabilities.streaming).toBe(true);
  });
});

describe("modelsFor()", () => {
  it("keeps only the models a platform can run", () => {
    const desktopOnly: ModelSpec = { ...fixture, id: "desktop", platforms: ["tauri-linux"] };
    expect(modelsFor([fixture, desktopOnly], "web").map((m) => m.id)).toEqual(["fake-tiny-pt-1"]);
    expect(modelsFor([fixture, desktopOnly], "tauri-linux").map((m) => m.id)).toEqual(["desktop"]);
  });
});

describe("validateCatalog()", () => {
  it("accepts a new model as data only", () => {
    expect(validateCatalog([...MODEL_CATALOG, fixture])).toEqual([]);
  });

  it.each([
    ["duplicate id", [fixture, fixture], "duplicate id fake-tiny-pt-1"],
    ["no files", [{ ...fixture, files: [] }], "fake-tiny-pt-1: no files"],
    [
      "http url",
      [{ ...fixture, files: [{ ...fixture.files[0], url: "http://x/a" }] }],
      "fake-tiny-pt-1/a.bin: url must be https",
    ],
    [
      "zero bytes",
      [{ ...fixture, files: [{ ...fixture.files[0], bytes: 0 }] }],
      "fake-tiny-pt-1/a.bin: bytes must be > 0",
    ],
    [
      "bad checksum",
      [
        {
          ...fixture,
          files: [{ ...fixture.files[0], checksum: { algo: "crc32c" as const, value: "x" } }],
        },
      ],
      "fake-tiny-pt-1/a.bin: checksum must be 4 bytes base64",
    ],
    ["no language", [{ ...fixture, languages: [] }], "fake-tiny-pt-1: no languages"],
    ["no platform", [{ ...fixture, platforms: [] }], "fake-tiny-pt-1: no platforms"],
    ["no name", [{ ...fixture, name: "" }], "fake-tiny-pt-1: no name"],
    ["http source", [{ ...fixture, source: "http://x" }], "fake-tiny-pt-1: source must be https"],
  ])("reports %s", (_name, catalog, message) => {
    expect(validateCatalog(catalog as ModelSpec[])).toContain(message);
  });
});
