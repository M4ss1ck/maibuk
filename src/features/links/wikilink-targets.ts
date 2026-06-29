export interface WikilinkData {
  notes: { id: string; title: string }[];
  books: { id: string; title: string }[];
  chapters: { id: string; bookId: string; title: string }[];
  headings: { chapterId: string; id: string; text: string }[];
}

export type WikilinkCandidate =
  | { kind: "note"; id: string; label: string }
  | { kind: "book"; id: string; label: string }
  | { kind: "chapter"; id: string; label: string }
  | { kind: "heading"; chapterId: string; id: string; label: string }
  | { kind: "createNote"; label: string };

const MAX_PER_KIND = 8;

export function buildWikilinkCandidates(query: string, data: WikilinkData): WikilinkCandidate[] {
  const q = query.trim().toLowerCase();
  const match = (text: string) => q.length === 0 || text.toLowerCase().includes(q);
  const out: WikilinkCandidate[] = [];

  for (const n of data.notes.filter((n) => match(n.title)).slice(0, MAX_PER_KIND)) {
    out.push({ kind: "note", id: n.id, label: n.title });
  }
  for (const b of data.books.filter((b) => match(b.title)).slice(0, MAX_PER_KIND)) {
    out.push({ kind: "book", id: b.id, label: b.title });
  }
  for (const c of data.chapters.filter((c) => match(c.title)).slice(0, MAX_PER_KIND)) {
    out.push({ kind: "chapter", id: c.id, label: c.title });
  }
  for (const h of data.headings.filter((h) => match(h.text)).slice(0, MAX_PER_KIND)) {
    out.push({
      kind: "heading",
      chapterId: h.chapterId,
      id: h.id,
      label: h.text,
    });
  }

  if (q.length > 0) {
    out.push({ kind: "createNote", label: query.trim() });
  }
  return out;
}
