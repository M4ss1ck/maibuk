import { readTextFile, writeTextFile, readDir, remove, mkdir, stat } from "@tauri-apps/plugin-fs";
import { appConfigDir, join } from "@tauri-apps/api/path";
import type { DirEntry } from "@tauri-apps/plugin-fs";
import type { BackupAdapter, BackupEntry, BackupPage, BackupPageOptions } from "@/lib/platform/types";
import { computeChecksum } from "@/lib/checksum";
import { parseTriggerFromFilename } from "@/features/backup/utils";

interface BackupMeta {
  trigger: BackupEntry["trigger"];
  createdAt: string;
  sizeBytes: number;
  checksum: string;
}

const BACKUP_FILENAME_PATTERN =
  /^maibuk-backup-(daily|pre-sync|pre-restore|manual)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.sql$/;
const BACKUP_TIMESTAMP_PATTERN =
  /^maibuk-backup-(?:daily|pre-sync|pre-restore|manual)-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.sql$/;

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
  return (
    typeof name === "string" &&
    /^maibuk-backup-(daily|pre-sync|pre-restore|manual)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.meta\.json$/.test(
      name
    )
  );
}

function normalizePageOptions(options: BackupPageOptions): BackupPageOptions {
  return {
    page: Math.max(1, Math.floor(options.page)),
    pageSize: Math.max(1, Math.floor(options.pageSize)),
  };
}

function timestampFromFilename(filename: string): number {
  const match = filename.match(BACKUP_TIMESTAMP_PATTERN);
  if (!match) return 0;
  const [, year, month, day, hour, minute, second] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

async function cleanupOrphanMetaFiles(
  backupDir: string,
  files: DirEntry[],
  sqlFiles: string[]
): Promise<void> {
  const metaFiles = files.map((file) => file.name).filter(isManagedMetaFile);
  const sqlNames = new Set(sqlFiles);
  for (const meta of metaFiles) {
    const expectedSql = meta.replace(/\.meta\.json$/, ".sql");
    if (!sqlNames.has(expectedSql)) {
      await remove(`${backupDir}/${meta}`).catch(() => {});
    }
  }
}

async function getBackupDir(customDir?: string): Promise<string> {
  if (customDir) return customDir;
  const configDir = await appConfigDir();
  const dir = await join(configDir, "backups");
  await mkdir(dir, { recursive: true }).catch(() => {
    // Directory already exists
  });
  return dir;
}

function metaPath(sqlPath: string): string {
  return sqlPath.replace(/\.sql$/, ".meta.json");
}

async function buildMetaFromSql(
  sqlPath: string,
  filename: string,
  sqlContent: string
): Promise<BackupMeta> {
  const fileStat = await stat(sqlPath);
  return {
    trigger: parseTriggerFromFilename(filename),
    createdAt: new Date(fileStat.mtime ?? Date.now()).toISOString(),
    sizeBytes: new Blob([sqlContent]).size,
    checksum: await computeChecksum(sqlContent),
  };
}

class TauriBackupAdapter implements BackupAdapter {
  constructor(private backupDir: string) {}

  async saveBackup(filename: string, sqlContent: string): Promise<void> {
    const safeFilename = ensureSafeFilename(filename);
    const sqlPath = `${this.backupDir}/${safeFilename}`;
    await writeTextFile(sqlPath, sqlContent);

    const meta = await buildMetaFromSql(sqlPath, safeFilename, sqlContent);
    await writeTextFile(metaPath(sqlPath), JSON.stringify(meta));
  }

  async listBackups(): Promise<BackupEntry[]> {
    let files: DirEntry[];
    try {
      files = await readDir(this.backupDir);
    } catch {
      return [];
    }

    const sqlFiles = files.map((file) => file.name).filter(isManagedSqlFile);
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

    await cleanupOrphanMetaFiles(this.backupDir, files, sqlFiles);

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return entries;
  }

  async listBackupsPage(options: BackupPageOptions): Promise<BackupPage> {
    const { page, pageSize } = normalizePageOptions(options);
    let files: DirEntry[];
    try {
      files = await readDir(this.backupDir);
    } catch {
      return {
        entries: [],
        totalCount: 0,
        totalSizeBytes: 0,
        page: 1,
        pageSize,
      };
    }

    const sqlFiles = files.map((file) => file.name).filter(isManagedSqlFile);
    await cleanupOrphanMetaFiles(this.backupDir, files, sqlFiles);

    const totalCount = sqlFiles.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const offset = (clampedPage - 1) * pageSize;

    const totalSizeBytes = (
      await Promise.all(
        sqlFiles.map(async (file) => {
          try {
            const fileStat = await stat(`${this.backupDir}/${file}`);
            return fileStat.size ?? 0;
          } catch {
            return 0;
          }
        })
      )
    ).reduce((sum, size) => sum + size, 0);

    const pageFiles = sqlFiles
      .map((file) => ({ file, timestamp: timestampFromFilename(file) }))
      .sort((a, b) => b.timestamp - a.timestamp || b.file.localeCompare(a.file))
      .slice(offset, offset + pageSize);

    const entries: BackupEntry[] = [];
    for (const { file } of pageFiles) {
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
        try {
          const fileStat = await stat(sqlPath);
          entries.push({
            filename: file,
            trigger: "unknown",
            createdAt: new Date(fileStat.mtime ?? timestampFromFilename(file)),
            sizeBytes: fileStat.size,
            checksum: "",
          });
        } catch {
          // File disappeared between readDir and stat, skip
        }
      }
    }

    return {
      entries,
      totalCount,
      totalSizeBytes,
      page: clampedPage,
      pageSize,
    };
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
    await remove(sqlPath).catch(() => {});
    await remove(metaPath(sqlPath)).catch(() => {});
  }
}

export async function createTauriBackup(customDir?: string): Promise<BackupAdapter> {
  const dir = await getBackupDir(customDir);
  return new TauriBackupAdapter(dir);
}
