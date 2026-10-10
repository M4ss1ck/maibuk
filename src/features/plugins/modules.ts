/**
 * Entry loading for a Plugin's ES modules. The entry and every module it
 * reaches is lexed; only relative specifiers that resolve to a file already in
 * the hashed folder are allowed. Bare specifiers, URLs, non-module targets,
 * non-literal dynamic imports, and import cycles are refused before anything
 * runs. Accepted imports are rewritten to the `blob:` URLs the sandbox frame
 * creates, in dependency order, because a module Worker started from a `blob:`
 * URL cannot resolve relative specifiers itself.
 *
 * A cycle is refused rather than reordered: a blob URL cannot be created
 * before the module it contains is final, and the module's final source names
 * its targets' URLs. A cycle therefore has no creation order.
 */

import { ImportType, init, parse } from "es-module-lexer";
import type {
  PluginFolderFile,
  PluginImportSite,
  PluginModulePlan,
  PluginModulePlanEntry,
  PluginModuleProblem,
} from "@/features/plugins/types";

const MODULE_PATTERN = /\.(?:js|mjs)$/;
const SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const decoder = new TextDecoder("utf-8", { fatal: true });

// Resolves a specifier against a folder-relative path; null when it escapes the folder.
function resolvePath(fromPath: string, specifier: string): string | null {  const segments = fromPath === "" ? [] : fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.length === 0 ? null : segments.join("/");
}

function isRelative(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier === "." ||
    specifier === ".."
  );
}

function isUrl(specifier: string): boolean {
  return specifier.startsWith("/") || SCHEME_PATTERN.test(specifier);
}

export async function planPluginModules(
  files: readonly PluginFolderFile[],
  entry: string
): Promise<PluginModulePlan> {
  await init;
  const byPath = new Map(files.map((file) => [file.path, file]));
  const problems: PluginModuleProblem[] = [];

  const entryPath = resolvePath("", entry);
  if (entryPath === null) {
    problems.push({
      code: "entry-missing",
      path: entry,
      message: `The entry "${entry}" resolves outside the Plugin folder`,
    });
    return { ok: false, problems };
  }
  if (!byPath.has(entryPath)) {
    problems.push({
      code: "entry-missing",
      path: entryPath,
      message: `The entry "${entryPath}" is not in the Plugin folder`,
    });
    return { ok: false, problems };
  }
  if (!MODULE_PATTERN.test(entryPath)) {
    problems.push({
      code: "entry-not-module",
      path: entryPath,
      message: `The entry "${entryPath}" is not a JavaScript module (.js or .mjs)`,
    });
    return { ok: false, problems };
  }

  const modules: PluginModulePlanEntry[] = [];
  const state = new Map<string, "visiting" | "done">();

  function visit(path: string): void {
    const status = state.get(path);
    if (status === "visiting") {
      problems.push({
        code: "cyclic-import",
        path,
        message: `"${path}" takes part in an import cycle; v1 refuses cycles`,
      });
      return;
    }
    if (status === "done") return;
    state.set(path, "visiting");

    const file = byPath.get(path);
    if (!file) return;
    let source: string;
    try {
      source = decoder.decode(file.bytes);
    } catch {
      problems.push({
        code: "invalid-source",
        path,
        message: `"${path}" is not valid UTF-8`,
      });
      return;
    }

    const [imports] = parse(source, path);
    const sites: PluginImportSite[] = [];
    for (const specifier of imports) {
      if (specifier.t === ImportType.ImportMeta) continue;
      const name = specifier.n;
      if (name === undefined) {
        problems.push({
          code: "dynamic-import",
          path,
          message: `A dynamic import in "${path}" must be a string literal`,
        });
        continue;
      }
      if (isRelative(name)) {
        const target = resolvePath(path, name);
        if (target === null || !byPath.has(target)) {
          problems.push({
            code: "missing-import",
            path,
            specifier: name,
            message: `"${name}" is not a file in the Plugin folder`,
          });
          continue;
        }
        if (!MODULE_PATTERN.test(target)) {
          problems.push({
            code: "not-a-module",
            path,
            specifier: name,
            message: `"${name}" is not a JavaScript module (.js or .mjs)`,
          });
          continue;
        }
        sites.push({
          start: specifier.s,
          end: specifier.e,
          kind: specifier.t === ImportType.Dynamic ? "dynamic" : "static",
          target,
        });
        visit(target);
        continue;
      }
      problems.push({
        code: isUrl(name) ? "url-import" : "bare-import",
        path,
        specifier: name,
        message: isUrl(name)
          ? `"${name}" is a URL; only relative imports inside the Plugin folder are allowed`
          : `"${name}" is a bare import; only relative imports inside the Plugin folder are allowed`,
      });
    }

    state.set(path, "done");
    modules.push({ path, source, imports: sites });
  }

  visit(entryPath);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, modules };
}

/** Replaces every import site with the `blob:` URL of the module it names. */
export function rewritePluginImports(
  source: string,
  sites: readonly PluginImportSite[],
  urlOf: (path: string) => string
): string {
  let rewritten = source;
  const ordered = [...sites].sort((a, b) => b.start - a.start);
  for (const site of ordered) {
    const url = urlOf(site.target);
    const replacement = site.kind === "static" ? url : JSON.stringify(url);
    rewritten = rewritten.slice(0, site.start) + replacement + rewritten.slice(site.end);
  }
  return rewritten;
}
