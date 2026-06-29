import { getDatabase } from "@/lib/db";

export interface ProjectAssetInput {
  id?: string;
  filename: string;
  href: string;
  mediaType: string;
  role?: string | null;
  dataBase64?: string | null;
  textContent?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
}

export interface ProjectAsset {
  id: string;
  bookId: string;
  filename: string;
  href: string;
  mediaType: string;
  role: string | null;
  dataBase64: string | null;
  textContent: string | null;
  sizeBytes: number | null;
  checksum: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ProjectAssetRow {
  id: string;
  book_id: string;
  filename: string;
  href: string;
  media_type: string;
  role: string | null;
  data_base64: string | null;
  text_content: string | null;
  size_bytes: number | null;
  checksum: string | null;
  created_at: number;
  updated_at: number;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function generateId(): string {
  return crypto.randomUUID();
}

function toModel(row: ProjectAssetRow): ProjectAsset {
  return {
    id: row.id,
    bookId: row.book_id,
    filename: row.filename,
    href: row.href,
    mediaType: row.media_type,
    role: row.role,
    dataBase64: row.data_base64,
    textContent: row.text_content,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
  };
}

export async function insertProjectAssets(
  bookId: string,
  assets: ProjectAssetInput[]
): Promise<ProjectAsset[]> {
  if (assets.length === 0) return [];

  const db = await getDatabase();
  const now = nowSeconds();
  const inserted: ProjectAsset[] = [];

  for (const asset of assets) {
    const id = asset.id ?? generateId();
    await db.execute(
      `INSERT INTO project_assets
        (id, book_id, filename, href, media_type, role, data_base64, text_content, size_bytes, checksum, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        bookId,
        asset.filename,
        asset.href,
        asset.mediaType,
        asset.role ?? null,
        asset.dataBase64 ?? null,
        asset.textContent ?? null,
        asset.sizeBytes ?? null,
        asset.checksum ?? null,
        now,
        now,
      ]
    );
    inserted.push({
      id,
      bookId,
      filename: asset.filename,
      href: asset.href,
      mediaType: asset.mediaType,
      role: asset.role ?? null,
      dataBase64: asset.dataBase64 ?? null,
      textContent: asset.textContent ?? null,
      sizeBytes: asset.sizeBytes ?? null,
      checksum: asset.checksum ?? null,
      createdAt: new Date(now * 1000),
      updatedAt: new Date(now * 1000),
    });
  }

  return inserted;
}

export async function listProjectAssets(bookId: string): Promise<ProjectAsset[]> {
  const db = await getDatabase();
  const rows = await db.select<ProjectAssetRow[]>(
    `SELECT id, book_id, filename, href, media_type, role, data_base64, text_content, size_bytes, checksum, created_at, updated_at
     FROM project_assets
     WHERE book_id = ?
     ORDER BY href ASC, id ASC`,
    [bookId]
  );
  return rows.map(toModel);
}

export interface SeparatorAssetInput {
  dataBase64: string;
  mediaType: string;
  filename: string;
}

const SEPARATOR_ROLE = "scene-break-separator";

export async function upsertSeparatorAsset(
  bookId: string,
  input: SeparatorAssetInput
): Promise<ProjectAsset> {
  const existing = await listProjectAssets(bookId);
  const match = existing.find(
    (asset) => asset.role === SEPARATOR_ROLE && asset.dataBase64 === input.dataBase64
  );
  if (match) return match;

  const href = `assets/scene-break-${generateId()}-${input.filename}`;
  const [inserted] = await insertProjectAssets(bookId, [
    {
      filename: input.filename,
      href,
      mediaType: input.mediaType,
      role: SEPARATOR_ROLE,
      dataBase64: input.dataBase64,
      sizeBytes: input.dataBase64.length,
      checksum: null,
    },
  ]);
  return inserted;
}
