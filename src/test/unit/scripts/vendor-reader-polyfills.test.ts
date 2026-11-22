/**
 * The core-js polyfills Reader ships ahead of pdf.js: chosen from the recent
 * APIs pdf.js calls unguarded, less those the oldest supported engine
 * (READER_ENGINE_FLOOR, Chrome 138, the last Android System WebView on Android
 * 8 and 9) already has. A pdf.js update that starts calling another such API
 * fails the freshness test until `node scripts/vendor-reader.mjs` reruns.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  POLYFILL_BUNDLE,
  POLYFILL_ENTRY,
  READER_ENGINE_FLOOR,
  VENDOR_DIR,
  pdfjsPolyfillModules,
  polyfillEntrySource,
} from "../../../../scripts/vendor-reader.mjs";

/** The vendored pdf.js sources, as Reader ships them. */
const pdfjsSources = ["pdf.min.mjs", "pdf.worker.min.mjs"].map((name) =>
  readFileSync(join(VENDOR_DIR, "pdfjs", name), "utf8")
);

/**
 * A fresh realm shaped like the floor engine: the natives Chrome 138 lacks are
 * deleted before the bundle runs, whatever the Node running the test has.
 */
function floorRealm(): ReturnType<typeof createContext> {
  const realm = createContext({});
  runInContext(
    `delete Math.sumPrecise;
     delete Map.prototype.getOrInsert;
     delete Map.prototype.getOrInsertComputed;
     delete WeakMap.prototype.getOrInsert;
     delete WeakMap.prototype.getOrInsertComputed;
     delete Uint8Array.fromBase64;
     delete Uint8Array.prototype.toBase64;
     delete Uint8Array.prototype.toHex;
     delete Promise.try;`,
    realm
  );
  return realm;
}

describe("Reader's pdf.js polyfills", () => {
  it("targets Chrome 138, the last WebView Android 8 and 9 receive", () => {
    expect(READER_ENGINE_FLOOR).toEqual({ chrome: "138", android: "138" });
  });

  it("finds the recent APIs pdf.js calls unguarded", () => {
    expect(pdfjsPolyfillModules(pdfjsSources)).toEqual(
      expect.arrayContaining([
        "es.map.get-or-insert-computed",
        "es.math.sum-precise",
        "es.promise.try",
        "es.uint8-array.from-base64",
        "es.uint8-array.to-hex",
      ])
    );
  });

  it("leaves out an API the floor engine already has", () => {
    const modules = pdfjsPolyfillModules(["new Map().keys().filter(Boolean)", "URL.parse(u)"]);
    expect(modules).toEqual([]);
  });

  it("ships an entry generated from the vendored pdf.js", () => {
    expect(readFileSync(POLYFILL_ENTRY, "utf8")).toBe(
      polyfillEntrySource(pdfjsPolyfillModules(pdfjsSources))
    );
  });

  it("bundles every polyfill the entry names, as a classic script with no exports", () => {
    const bundle = readFileSync(POLYFILL_BUNDLE, "utf8");
    expect(bundle.startsWith("/*! core-js ")).toBe(true);
    expect(bundle).not.toMatch(/\bexport\s*\{/);
    expect(bundle).not.toMatch(/^\s*import\s/m);
  });

  it("gives a floor engine every API pdf.js needs from it", async () => {
    const realm = floorRealm();
    runInContext(readFileSync(POLYFILL_BUNDLE, "utf8"), realm);
    const results = runInContext(
      `const map = new Map([["kept", 1]]);
       const weak = new WeakMap();
       const key = {};
       ({
         sum: Math.sumPrecise([1e20, 0.1, -1e20]),
         computed: map.getOrInsertComputed("added", () => 2),
         kept: map.getOrInsert("kept", 9),
         weak: weak.getOrInsertComputed(key, () => 3) + weak.getOrInsert(key, 9),
         bytes: Array.from(Uint8Array.fromBase64("AQL/")),
         base64: new Uint8Array([1, 2, 255]).toBase64(),
         hex: new Uint8Array([1, 2, 255]).toHex(),
         tried: Promise.try((value) => value * 2, 21),
       })`,
      realm
    );
    expect({ ...results, tried: await results.tried }).toEqual({
      sum: 0.1,
      computed: 2,
      kept: 1,
      weak: 6,
      bytes: [1, 2, 255],
      base64: "AQL/",
      hex: "0102ff",
      tried: 42,
    });
  });
});
