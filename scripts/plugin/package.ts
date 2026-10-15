/**
 * Packs a built Plugin folder into the `.zip` an author installs (issue #455).
 * The folder's files land at the zip root (`manifest.json` beside the entry),
 * sorted by path, and every entry carries one fixed time, so two runs over the
 * same folder produce byte-identical bytes and a diff between releases means a
 * real change. The zip's parent directory is created when it does not exist.
 */
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { zipSync } from "fflate";

/**
 * The one modification time every packaged entry carries. A date before 1980
 * is out of the ZIP format's range, and building it in local time keeps the
 * stored fields the same whatever the machine's timezone is.
 */
export const PACKAGE_MTIME = new Date(1980, 0, 1, 0, 0, 0);

/** What {@link packagePlugin} wrote. */
export interface PackageResult {
  /** The zip path the caller asked for. */
  zipPath: string;
  /** The packed files, Plugin-relative, sorted with forward slashes. */
  files: string[];
}

/** Every file under `dir`, as Plugin-relative POSIX paths, sorted. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, "/"))
    .sort();
}

/**
 * Zips the built Plugin folder at `builtDir` into `zipPath`, creating the zip's
 * parent directory. Files are stored at the zip root, sorted by path, with a
 * fixed time, so the output is deterministic.
 */
export async function packagePlugin(builtDir: string, zipPath: string): Promise<PackageResult> {
  const files = listFiles(builtDir);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file] = readFileSync(join(builtDir, file));
  }

  const zip = zipSync(entries, { level: 9, mtime: PACKAGE_MTIME });
  await mkdir(dirname(zipPath), { recursive: true });
  await writeFile(zipPath, zip);
  return { zipPath, files };
}
