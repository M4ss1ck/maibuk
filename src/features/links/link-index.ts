// src/features/links/link-index.ts
import { getDatabase } from "@/lib/db";
import { extractLinks } from "@/features/links/link-uri";

export interface ReindexSourceArgs {
  sourceType: "note" | "chapter";
  sourceId: string;
  sourceBookId?: string;
  contentHtml: string | null | undefined;
}

export interface BacklinkEntry {
  sourceId: string;
  title: string;
}

export async function reindexSource(args: ReindexSourceArgs): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM links WHERE source_id = ?", [args.sourceId]);

  const links = extractLinks(args.contentHtml);
  const now = Math.floor(Date.now() / 1000);
  for (const link of links) {
    await db.execute(
      `INSERT INTO links
        (id, source_type, source_id, source_book_id, target_type, target_id, target_heading_id, label, resolved, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        crypto.randomUUID(),
        args.sourceType,
        args.sourceId,
        args.sourceBookId ?? null,
        link.targetType,
        link.targetId,
        link.headingId ?? null,
        link.label,
        now,
      ]
    );
  }
}

export async function getBacklinksForNote(noteId: string): Promise<BacklinkEntry[]> {
  const db = await getDatabase();
  const rows = await db.select<{ source_id: string; title: string }[]>(
    `SELECT DISTINCT l.source_id AS source_id, n.title AS title
       FROM links l
       JOIN notes n ON n.id = l.source_id
      WHERE l.source_type = 'note' AND l.target_type = 'note' AND l.target_id = ?
      ORDER BY n.title ASC`,
    [noteId]
  );
  return rows.map((r) => ({ sourceId: r.source_id, title: r.title }));
}
