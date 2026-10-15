/**
 * Folder listing shared by the Plugin tooling (issue #455). One directory
 * walker and one test-file pattern, so the import boundary, the layout check,
 * and the packer agree on which files a Plugin has and which of them are tests.
 * A leaf: no `@/` import and no dependency, so any tooling module can use it.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The `*.test.*` and `test-support.*` files a Plugin writes its tests in. */
export const TEST_FILE_PATTERN = /(\.test\.[cm]?[jt]sx?$)|((^|\/)test-support\.[cm]?[jt]sx?$)/;

/** How {@link listFiles} walks a folder. */
export interface ListFilesOptions {
  /** Directory names never descended into. */
  prune?: ReadonlySet<string>;
  /** Skip a root-level `scripts/` folder. */
  pruneRootScripts?: boolean;
}

/**
 * Every file under `dir`, as forward-slash relative paths, sorted. A directory
 * whose name is in `prune`, and a root-level `scripts/` when `pruneRootScripts`
 * is set, is never descended into, so a repo with a large `node_modules` lists
 * fast.
 */
export function listFiles(dir: string, options: ListFilesOptions = {}): string[] {
  const { prune, pruneRootScripts = false } = options;
  const found: string[] = [];
  const walk = (current: string, relDir: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (prune?.has(entry.name)) continue;
        if (pruneRootScripts && relDir === "" && entry.name === "scripts") continue;
        walk(join(current, entry.name), relPath);
      } else if (entry.isFile()) {
        found.push(relPath);
      }
    }
  };
  walk(dir, "");
  return found.sort((left, right) => (left < right ? -1 : 1));
}
