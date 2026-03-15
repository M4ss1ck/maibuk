import { readTextFile, writeTextFile, readDir, remove, mkdir, stat } from "@tauri-apps/plugin-fs";
import { appConfigDir } from "@tauri-apps/api/path";
import type { BackupAdapter, BackupEntry } from "../types";

interface BackupMeta {
  trigger: BackupEntry["trigger"];
  createdAt: string;
  sizeBytes: number;
  checksum: string;
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

class TauriBackupAdapter implements BackupAdapter {
  constructor(private backupDir: string) {}

  async saveBackup(
    filename: string,
    sqlContent: string,
    trigger: BackupEntry["trigger"],
    checksum: string,
  ): Promise<void> {
    const sqlPath = `${this.backupDir}/${filename}`;
    await writeTextFile(sqlPath, sqlContent);

    const fileStat = await stat(sqlPath);
    const meta: BackupMeta = {
      trigger,
      createdAt: new Date().toISOString(),
      sizeBytes: fileStat.size,
      checksum,
    };
    await writeTextFile(metaPath(sqlPath), JSON.stringify(meta));
  }

  async listBackups(): Promise<BackupEntry[]> {
    let files;
    try {
      files = await readDir(this.backupDir);
    } catch {
      return [];
    }

    const sqlFiles = files.filter((f) => f.name?.endsWith(".sql"));
    const entries: BackupEntry[] = [];

    for (const file of sqlFiles) {
      const sqlPath = `${this.backupDir}/${file.name}`;
      const metaFile = metaPath(sqlPath);

      try {
        const metaContent = await readTextFile(metaFile);
        const meta: BackupMeta = JSON.parse(metaContent);
        entries.push({
          filename: file.name!,
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
            filename: file.name!,
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
    const metaFiles = files.filter((f) => f.name?.endsWith(".meta.json"));
    const sqlNames = new Set(sqlFiles.map((f) => f.name));
    for (const meta of metaFiles) {
      const expectedSql = meta.name!.replace(/\.meta\.json$/, ".sql");
      if (!sqlNames.has(expectedSql)) {
        await remove(`${this.backupDir}/${meta.name}`).catch(() => {});
      }
    }

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return entries;
  }

  async readBackup(filename: string): Promise<string> {
    return readTextFile(`${this.backupDir}/${filename}`);
  }

  async deleteBackup(filename: string): Promise<void> {
    const sqlPath = `${this.backupDir}/${filename}`;
    await remove(sqlPath).catch(() => {});
    await remove(metaPath(sqlPath)).catch(() => {});
  }
}

export async function createTauriBackup(customDir?: string): Promise<BackupAdapter> {
  const dir = await getBackupDir(customDir);
  return new TauriBackupAdapter(dir);
}
