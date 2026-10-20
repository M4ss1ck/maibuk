/**
 * Built-in Plugin detection for the `plugin:*` tooling (issue #589). A
 * Built-in is a Plugin folder that lives directly under the checkout's
 * `plugins/` folder and is named after its own manifest id
 * (`plugins/<id>/` holding a `manifest.json` with that same id). Any other
 * folder, one elsewhere, one whose name differs from the id, or one with no
 * readable manifest, is a third-party Plugin and keeps the external rules.
 * This module imports no `@/` code, so any tooling module can use it.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Whether the Plugin at `pluginRoot` is a Built-in of the checkout at
 * `maibukRoot`: its parent is `<maibukRoot>/plugins` and its folder name is
 * the manifest's own id.
 */
export function isBuiltInPlugin(pluginRoot: string, maibukRoot: string): boolean {
  const root = resolve(pluginRoot);
  if (dirname(root) !== join(resolve(maibukRoot), "plugins")) return false;
  let id: unknown;
  try {
    id = (JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { id?: unknown }).id;
  } catch {
    return false;
  }
  return typeof id === "string" && id !== "" && basename(root) === id;
}
