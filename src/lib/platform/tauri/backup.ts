import { readTextFile, writeTextFile, readDir, remove, mkdir, stat } from "@tauri-apps/plugin-fs";
import { appConfigDir } from "@tauri-apps/api/path";
import type { BackupAdapter, BackupEntry } from "../types";

interface BackupMeta {
  trigger: BackupEntry["trigger"];
  createdAt: string;
  sizeBytes: number;
  checksum: string;
}

const BACKUP_FILENAME_PATTERN = /^maibuk-backup-(launch|close|pre-sync|pre-restore|manual)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/;

function parseTriggerFromFilename(filename: string): BackupEntry["trigger"] {
  const match = filename.match(/^maibuk-backup-(launch|close|pre-sync|pre-restore|manual)-/);
  return match?.[1] as BackupEntry["trigger"] ?? "unknown";
}

function ensureSafeFilename(filename: string): string {
  if (!BACKUP_FILENAME_PATTERN.test(filename)) {
    throw new Error(`Invalid backup filename: ${filename}`);
  }
  return filename;
}

function isManagedSqlFile(name: string | undefined): name is string {
  return typeof name === "string" && BACKUP_FILENAME_PATTERN.test(name);
}

function isManagedMetaFile(name: string | undefined): name is string {
  return typeof name === "string"
    && /^maibuk-backup-(launch|close|pre-sync|pre-restore|manual)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.meta\.json$/.test(name);
}

async function computeChecksum(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getBackupDir(customDir?: string): Promise<string> {
  if (customDir) return customDir;
  const configDir = await appConfigDir();
  const dir = `${configDir}backups`;
  await mkdir(dir, { recursive: true }).catch(() => {
    // Directory already exists
  });
  return dir;
}

function metaPath(sqlPath: string): string {
  return sqlPath.replace(/\.sql$/, ".meta.json");
}

async function buildMetaFromSql(sqlPath: string, filename: string, sqlContent: string): Promise<BackupMeta> {
  const fileStat = await stat(sqlPath);
  return {
    trigger: parseTriggerFromFilename(filename),
    createdAt: new Date(fileStat.mtime ?? Date.now()).toISOString(),
    sizeBytes: fileStat.size,
    checksum: await computeChecksum(sqlContent),
  };
}

class TauriBackupAdapter implements BackupAdapter {
  constructor(private backupDir: string) { }

  async saveBackup(filename: string, sqlContent: string): Promise<void> {
    const safeFilename = ensureSafeFilename(filename);
    const sqlPath = `${this.backupDir}/${safeFilename}`;
    await writeTextFile(sqlPath, sqlContent);

    const meta = await buildMetaFromSql(sqlPath, safeFilename, sqlContent);
    await writeTextFile(metaPath(sqlPath), JSON.stringify(meta));
  }

  async listBackups(): Promise<BackupEntry[]> {
    let files;
    try {
      files = await readDir(this.backupDir);
    } catch {
      return [];
    }

    const sqlFiles = files
      .map((file) => file.name)
      .filter(isManagedSqlFile);
    const entries: BackupEntry[] = [];

    for (const file of sqlFiles) {
      const sqlPath = `${this.backupDir}/${file}`;
      const metaFile = metaPath(sqlPath);

      try {
        const metaContent = await readTextFile(metaFile);
        const meta: BackupMeta = JSON.parse(metaContent);
        entries.push({
          filename: file,
          trigger: meta.trigger,
          createdAt: new Date(meta.createdAt),
          sizeBytes: meta.sizeBytes,
          checksum: meta.checksum,
        });
      } catch {
        // Orphan .sql without .meta.json — list with "unknown" trigger
        try {
          const fileStat = await stat(sqlPath);
          entries.push({
            filename: file,
            trigger: "unknown",
            createdAt: new Date(fileStat.mtime ?? Date.now()),
            sizeBytes: fileStat.size,
            checksum: "",
          });
        } catch {
          // File disappeared between readDir and stat, skip
        }
      }
    }

    // Clean up orphan .meta.json files (no matching .sql)
    const metaFiles = files
      .map((file) => file.name)
      .filter(isManagedMetaFile);
    const sqlNames = new Set(sqlFiles);
    for (const meta of metaFiles) {
      const expectedSql = meta.replace(/\.meta\.json$/, ".sql");
      if (!sqlNames.has(expectedSql)) {
        await remove(`${this.backupDir}/${meta}`).catch(() => { });
      }
    }

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return entries;
  }

  async readBackup(filename: string): Promise<string> {
    const safeFilename = ensureSafeFilename(filename);
    const sqlPath = `${this.backupDir}/${safeFilename}`;
    const metaFilePath = metaPath(sqlPath);
    const sqlContent = await readTextFile(sqlPath);

    let meta: BackupMeta;
    try {
      meta = JSON.parse(await readTextFile(metaFilePath)) as BackupMeta;
    } catch {
      meta = await buildMetaFromSql(sqlPath, safeFilename, sqlContent);
      await writeTextFile(metaFilePath, JSON.stringify(meta));
    }

    const checksum = await computeChecksum(sqlContent);
    if (checksum !== meta.checksum) {
      throw new Error(`Backup checksum mismatch: ${safeFilename}`);
    }

    return sqlContent;
  }

  async deleteBackup(filename: string): Promise<void> {
    const safeFilename = ensureSafeFilename(filename);
    const sqlPath = `${this.backupDir}/${safeFilename}`;
    await remove(sqlPath).catch(() => { });
    await remove(metaPath(sqlPath)).catch(() => { });
  }
}

export async function createTauriBackup(customDir?: string): Promise<BackupAdapter> {
  const dir = await getBackupDir(customDir);
  return new TauriBackupAdapter(dir);
}
