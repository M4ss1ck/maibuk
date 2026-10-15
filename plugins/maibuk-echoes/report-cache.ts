/**
 * The Echoes report cache: each computed report, kept in memory for the life of
 * one Plugin runtime, so a revisit to the report page shows it without reading
 * the Book again. An entry goes stale when a `library.changed` touches its Book;
 * only the author's Refresh recomputes it. Least-recently-used entries are
 * evicted past the limit.
 */

import type { EchoSettings } from "./find-echoes";
import type { EchoReport, ReportChapter } from "./report";

/** One kept report: the Book it belongs to, its Chapters, and whether it is out of date. */
export interface ReportCacheEntry {
  bookId: string;
  report: EchoReport;
  chapters: readonly ReportChapter[];
  stale: boolean;
}

/** The Echoes report cache. Recency is the Map's insertion order: a hit moves its entry last. */
export interface ReportCache {
  get(key: string): ReportCacheEntry | undefined;
  set(key: string, entry: ReportCacheEntry): void;
  delete(key: string): void;
  /** Marks every entry of one Book out of date. */
  markStale(bookId: string): void;
  /** The distinct Book ids the cache holds entries for. */
  bookIds(): string[];
}

/** Keeps the `limit` most recently used entries; older ones are evicted. */
export function createReportCache(limit = 8): ReportCache {
  const entries = new Map<string, ReportCacheEntry>();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry;
    },
    set(key, entry) {
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    markStale(bookId) {
      for (const [key, entry] of entries) {
        if (entry.bookId === bookId && !entry.stale) entries.set(key, { ...entry, stale: true });
      }
    },
    bookIds() {
      return [...new Set([...entries.values()].map((entry) => entry.bookId))];
    },
  };
}

/**
 * The cache key for one report: the Book, the scope, and the whole detection
 * settings object. Object keys are sorted at every depth, so the order a
 * settings object was built in never splits the cache.
 */
export function reportCacheKey(bookId: string, scopeKey: string, settings: EchoSettings): string {
  return JSON.stringify([bookId, scopeKey, sortKeys(settings)]);
}

/** A copy of a JSON-like value with every object's keys in sorted order. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])])
    );
  }
  return value;
}
