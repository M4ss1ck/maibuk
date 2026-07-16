import { formatCodePoint } from "./names";
import type { SymbolEntry } from "./types";

const HEX_QUERY = /^(u\+)?[0-9a-f]{2,6}$/;

export function searchSymbols(
  entries: SymbolEntry[],
  query: string,
  category: string | null
): SymbolEntry[] {
  const pool = category ? entries.filter((e) => e.category === category) : entries;
  const q = query.trim().toLowerCase();
  if (!q) return pool;

  const hexCode = HEX_QUERY.test(q)
    ? formatCodePoint(Number.parseInt(q.replace(/^u\+/, ""), 16))
    : null;

  const exact: SymbolEntry[] = [];
  const prefix: SymbolEntry[] = [];
  const substring: SymbolEntry[] = [];
  for (const e of pool) {
    if (e.glyph === query.trim() || (hexCode !== null && e.code === hexCode)) {
      exact.push(e);
      continue;
    }
    const label = e.label.toLowerCase();
    if (label === q) exact.push(e);
    else if (label.startsWith(q)) prefix.push(e);
    else if (e.search.includes(q)) substring.push(e);
  }
  return [...exact, ...prefix, ...substring];
}
