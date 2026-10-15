/**
 * The per-runtime report cache (unit 3): LRU eviction, the stale mark per Book,
 * and the key that splits on a detection setting but never on key order.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_ECHO_SETTINGS, type EchoSettings } from "./find-echoes";
import { createReportCache, reportCacheKey, type ReportCacheEntry } from "./report-cache";
import { EMPTY_REPORT } from "./report";

function entry(bookId: string, stale = false): ReportCacheEntry {
  return { bookId, report: EMPTY_REPORT, chapters: [{ id: `${bookId}-c1`, text: "" }], stale };
}

describe("createReportCache", () => {
  it("returns what was set under a key, and undefined for an unknown key", () => {
    const cache = createReportCache();
    const kept = entry("b1");

    cache.set("k1", kept);

    expect(cache.get("k1")).toBe(kept);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("evicts the least recently used entry past the limit", () => {
    const cache = createReportCache(2);
    cache.set("a", entry("b1"));
    cache.set("b", entry("b1"));

    cache.set("c", entry("b1"));

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeDefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("refreshes an entry's recency on a get, so a read keeps it past an eviction", () => {
    const cache = createReportCache(2);
    cache.set("a", entry("b1"));
    cache.set("b", entry("b1"));

    // Reading "a" makes "b" the least recently used entry.
    expect(cache.get("a")).toBeDefined();
    cache.set("c", entry("b1"));

    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });

  it("uses a default limit of eight entries", () => {
    const cache = createReportCache();
    for (let index = 0; index < 9; index++) cache.set(`k${index}`, entry("b1"));

    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k1")).toBeDefined();
    expect(cache.get("k8")).toBeDefined();
  });

  it("marks stale only the entries of the Book that changed", () => {
    const cache = createReportCache();
    cache.set("a", entry("b1"));
    cache.set("b", entry("b2"));
    cache.set("c", entry("b1", true));

    cache.markStale("b1");

    expect(cache.get("a")?.stale).toBe(true);
    expect(cache.get("b")?.stale).toBe(false);
    expect(cache.get("c")?.stale).toBe(true);
  });

  it("keeps the entry's report and chapters when it is marked stale", () => {
    const cache = createReportCache();
    const kept = entry("b1");
    cache.set("a", kept);

    cache.markStale("b1");

    expect(cache.get("a")).toEqual({ ...kept, stale: true });
  });

  it("deletes one key and lists the distinct Books it holds", () => {
    const cache = createReportCache();
    cache.set("a", entry("b1"));
    cache.set("b", entry("b1"));
    cache.set("c", entry("b2"));

    expect(cache.bookIds().sort()).toEqual(["b1", "b2"]);

    cache.delete("c");

    expect(cache.get("c")).toBeUndefined();
    expect(cache.bookIds()).toEqual(["b1"]);
  });
});

describe("reportCacheKey", () => {
  it("is the same for settings with the same values in a different key order", () => {
    const reversed = Object.fromEntries(
      Object.entries(DEFAULT_ECHO_SETTINGS).reverse()
    ) as EchoSettings;

    expect(reportCacheKey("b1", "whole", DEFAULT_ECHO_SETTINGS)).toBe(
      reportCacheKey("b1", "whole", reversed)
    );
  });

  it("differs when a detection setting's value differs", () => {
    const base = reportCacheKey("b1", "whole", DEFAULT_ECHO_SETTINGS);

    expect(reportCacheKey("b1", "whole", { ...DEFAULT_ECHO_SETTINGS, stemming: false })).not.toBe(
      base
    );
    expect(
      reportCacheKey("b1", "whole", { ...DEFAULT_ECHO_SETTINGS, ignore: ["harbor"] })
    ).not.toBe(base);
  });

  it("differs by Book and by scope", () => {
    const base = reportCacheKey("b1", "whole", DEFAULT_ECHO_SETTINGS);

    expect(reportCacheKey("b2", "whole", DEFAULT_ECHO_SETTINGS)).not.toBe(base);
    expect(reportCacheKey("b1", "c1", DEFAULT_ECHO_SETTINGS)).not.toBe(base);
  });

  it("sorts nested object keys too, so a nested key order never splits the cache", () => {
    const nestedA = { a: { x: 1, y: 2 }, b: 1 } as unknown as EchoSettings;
    const nestedB = { b: 1, a: { y: 2, x: 1 } } as unknown as EchoSettings;

    expect(reportCacheKey("b1", "whole", nestedA)).toBe(reportCacheKey("b1", "whole", nestedB));
  });
});
