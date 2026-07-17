import { formatCodePoint } from "./names";
import type { SymbolEntry } from "./types";

const HEX_QUERY = /^(u\+)?[0-9a-f]{2,6}$/;

export function searchSymbols(
  entries: SymbolEntry[],
  query: string,
  category: string | null,
  limit = Number.POSITIVE_INFINITY
): SymbolEntry[] {
  const pool = category ? entries.filter((e) => e.category === category) : entries;
  const q = query.trim().toLowerCase();
  if (limit <= 0) return [];
  if (!q) return pool.length <= limit ? pool : pool.slice(0, limit);

  const hexCode = HEX_QUERY.test(q)
    ? formatCodePoint(Number.parseInt(q.replace(/^u\+/, ""), 16))
    : null;

  const exact: SymbolEntry[] = [];
  const prefix: SymbolEntry[] = [];
  const substring: SymbolEntry[] = [];
  for (const e of pool) {
    if (e.glyph === query.trim() || (hexCode !== null && e.code === hexCode)) {
      if (exact.length < limit) exact.push(e);
      continue;
    }
    if (e.search === q || e.search.startsWith(`${q}|`)) {
      if (exact.length < limit) exact.push(e);
    } else if (e.search.startsWith(q)) {
      if (prefix.length < limit) prefix.push(e);
    } else if (e.search.includes(q) && substring.length < limit) {
      substring.push(e);
    }
  }
  return [...exact, ...prefix, ...substring].slice(0, limit);
}
