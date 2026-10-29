/**
 * Runtime validation for a Plugin folder's `manifest.json` and its
 * `locales/<lang>.json` files (ADR 0022). Structural rules come from the Zod
 * schema, so the shipped `manifest.schema.json` cannot drift from what the app
 * accepts; the rules JSON Schema cannot express (references between
 * contributions, permission hosts, rename maps, icon names, caps) run here and
 * report every problem with the field path that caused it.
 *
 * Validation returns the manifest with its rename maps collapsed (a→b, b→c
 * becomes a→c), so consumers never re-derive chains.
 */
import { z } from "zod";
import { normalizeVoicePhraseList } from "@/features/dictation/voice-commands";
import { PluginRenameError, collapseContributionRenames } from "@/features/plugins/ids";
import LUCIDE_ICON_NAMES from "@/features/plugins/lucide-icon-names.json";
import { localeField } from "@/features/plugins/manifest-constants";
import {
  type PluginIconSpec,
  inlineIconProblem,
  isInlineIcon,
} from "@/features/plugins/inline-icon";
import { normalizeRelativePath } from "@/features/plugins/relative-path";
import {
  MANIFEST_LANGUAGES,
  builtInPluginManifestSchema,
  pluginManifestSchema,
} from "@/features/plugins/manifest-schema";
import { isValidRange, parseSemver } from "@/features/plugins/semver";
import type {
  LocaleValidation,
  ManifestProblem,
  ManifestValidation,
  ManifestValidationOptions,
  PluginManifest,
} from "@/features/plugins/types";
import { isCoreContextName, isReservedContextName } from "@/lib/shortcut-registry";
import {
  isRecordableStep,
  isReservedOnWeb,
  normalizeShortcut,
  normalizeStep,
} from "@/lib/shortcut-keys";

// The locale application is pure and Zod-free; it lives in `manifest-constants`
// so the Settings card can localize a manifest name without this module. It is
// re-exported here so the feature's existing importers keep one path (#437).
export { applyPluginLocale } from "@/features/plugins/manifest-constants";

/** Caps that protect the host from a hostile or runaway manifest. The budget
 * decision (#401) froze runtime limits but no manifest numbers; these are this
 * slice's proposal, kept in one place so they are easy to tune. */
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_LOCALE_BYTES = 64 * 1024;
export const CONTRIBUTION_LIMITS = {
  commands: 50,
  pages: 20,
  sidebarEntries: 20,
  settingsRows: 50,
  toolbarButtons: 20,
  itemMenuEntries: 50,
} as const;

const LUCIDE_ICON_NAMES_SET: ReadonlySet<string> = new Set(LUCIDE_ICON_NAMES);

/** The ten exact Plugin Permission strings; `network:<host>` is the eleventh. */
export const PLUGIN_PERMISSION_NAMES = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "editor:write",
  "secrets",
  "clipboard",
  "process",
  "serve",
  "files:pick",
] as const;

const PERMISSION_NAMES: ReadonlySet<string> = new Set(PLUGIN_PERMISSION_NAMES);
const HOST_LABEL = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
// A leading `*.` must cover at least two labels: `*.example.com` is a host,
// `*.com` is a whole top-level domain.
const NETWORK_HOST_PATTERN = new RegExp(
  `^(?:\\*\\.${HOST_LABEL}\\.${HOST_LABEL}(?:\\.${HOST_LABEL})*|${HOST_LABEL}(?:\\.${HOST_LABEL})*)$`
);
const NETWORK_PERMISSION_PREFIX = "network:";

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out === "" ? String(part) : `.${String(part)}`;
  }
  return out;
}

function problemsFromZod(error: z.ZodError): ManifestProblem[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

type AddProblem = (path: string, message: string) => void;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function permissionProblem(permission: string): string | null {
  if (PERMISSION_NAMES.has(permission)) return null;
  if (permission.startsWith(NETWORK_PERMISSION_PREFIX)) {
    const host = permission.slice(NETWORK_PERMISSION_PREFIX.length);
    if (host !== "" && NETWORK_HOST_PATTERN.test(host)) return null;
    if (host.includes(":")) {
      return `"${permission}" must name a network host without a port, like "network:localhost"`;
    }
    return `"${permission}" must name a network host, like "network:api.example.com" (a wildcard covers at least two labels, like "network:*.example.com")`;
  }
  return `"${permission}" is not a known Plugin Permission`;
}

/**
 * The shape rules a Plugin-folder-relative path must follow, as a predicate
 * phrase (`must be ...`), or null. One description for every Plugin path — the
 * manifest's `entry`, `icon`, and page `frame` — so they agree.
 */
function relativePathShapeProblem(value: string): string | null {
  if (value.includes("\\")) return "must use forward slashes";
  if (value.includes("://")) return "must be a relative path, not a URL";
  if (value.startsWith("/")) return "must be relative to the Plugin folder";
  if (value.split("/").some((segment) => segment === "..")) {
    return "must not leave the Plugin folder";
  }
  if (value.split("/").some((segment, index) => segment === "" && index > 0)) {
    return "must not have empty path segments";
  }
  return null;
}

/** The rules a Plugin-folder-relative path must follow; `subject` names it. */
function relativePathProblem(value: string, subject: string): string | null {
  const problem = relativePathShapeProblem(value);
  return problem === null ? null : `${subject} ${problem}`;
}

/**
 * The rules a Plugin-folder-relative path to a file with `extension` (`.html`)
 * must follow, as a predicate phrase, or null. Shared by a page's `frame` path
 * and the kit's `Frame` `src` (`src/features/plugins/remote-ui/validate.ts`).
 */
export function relativeFileProblem(value: string, extension: string): string | null {
  const shape = relativePathShapeProblem(value);
  if (shape !== null) return shape;
  if (value.includes("?") || value.includes("#")) return "must not carry a query or fragment";
  if (!value.endsWith(extension)) return `must point to an ${extension} file`;
  return null;
}

/** A page's `frame`: a relative `.html` path inside the Plugin folder. */
function frameProblem(frame: string): string | null {
  const problem = relativeFileProblem(frame, ".html");
  return problem === null ? null : `frame ${problem}`;
}

export { normalizeRelativePath };
export { MAX_INLINE_ICON_ELEMENTS } from "@/features/plugins/inline-icon";

function entryProblem(entry: string): string | null {
  const pathProblem = relativePathProblem(entry, "entry");
  if (pathProblem !== null) return pathProblem;
  if (entry.includes("?") || entry.includes("#")) {
    return "entry must not carry a query or fragment";
  }
  if (!/\.(js|mjs)$/u.test(entry)) return "entry must point to a .js or .mjs ES module";
  return null;
}

function iconProblem(icon: PluginIconSpec): string | null {
  if (isInlineIcon(icon)) return inlineIconProblem(icon);
  if (icon.endsWith(".svg")) {
    const subject = `the .svg icon "${icon}"`;
    const pathProblem = relativePathProblem(icon, subject);
    if (pathProblem !== null) return pathProblem;
    if (icon.slice(icon.lastIndexOf("/") + 1) === ".svg") {
      return `${subject} must have a file name, like "icons/echo.svg"`;
    }
    return null;
  }
  if (!LUCIDE_ICON_NAMES_SET.has(icon)) {
    return `"${icon}" is not a Lucide icon name or a relative .svg path`;
  }
  return null;
}

function checkShortcutSteps(
  shortcut: readonly string[],
  path: string,
  web: boolean,
  add: AddProblem
): void {
  const normalized = normalizeShortcut(shortcut);
  if (normalized === null) {
    const badIndex = shortcut.findIndex((raw) => normalizeStep(raw) === null);
    add(
      badIndex === -1 ? path : `${path}[${badIndex}]`,
      `"${shortcut[badIndex === -1 ? 0 : badIndex]}" is not a valid Shortcut`
    );
    return;
  }
  normalized.forEach((step, index) => {
    if (!isRecordableStep(step)) {
      add(`${path}[${index}]`, `"${shortcut[index]}" is not a recordable Shortcut step`);
      return;
    }
    if (web && isReservedOnWeb(step)) {
      add(`${path}[${index}]`, `"${shortcut[index]}" is reserved by the browser on the web`);
    }
  });
}

function checkVoicePhrases(phrases: readonly string[], path: string, add: AddProblem): void {
  const seen = new Set<string>();
  phrases.forEach((phrase, index) => {
    const normalized = normalizeVoicePhraseList([phrase]);
    if (normalized.length === 0) {
      add(`${path}[${index}]`, `"${phrase}" must be a Voice Command phrase of at least two words`);
      return;
    }
    const key = normalized[0].toLowerCase().replace(/\s+/gu, " ");
    if (seen.has(key)) {
      add(`${path}[${index}]`, `duplicate Voice Command phrase "${phrase}"`);
      return;
    }
    seen.add(key);
  });
}

function checkDuplicateIds(
  items: readonly { id: string }[],
  basePath: string,
  kind: string,
  add: AddProblem
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      add(`${basePath}[${index}].id`, `duplicate ${kind} id "${item.id}"`);
    }
    seen.add(item.id);
  });
}

function checkContributionPlatforms(
  platforms: readonly string[] | undefined,
  path: string,
  manifest: PluginManifest,
  add: AddProblem
): void {
  if (platforms === undefined) return;
  const own = new Set<string>(manifest.platforms);
  for (const platform of platforms) {
    if (!own.has(platform)) {
      add(
        path,
        `"${platform}" is not one of the Plugin's platforms (${manifest.platforms.join(", ")})`
      );
    }
  }
  if (new Set(platforms).size !== platforms.length) add(path, "must not list a platform twice");
}

/**
 * A contribution's effective platforms (its own, otherwise the Plugin's) must
 * be a subset of the effective platforms of what it references — its Command,
 * or for a sidebar entry its page. Anything else is a surface the host would
 * register while the Command or page it points at is filtered out on the same
 * platform, which crashes the shell (#482). `host` names the reference in the
 * message ("Command" or "page").
 */
function checkReferencePlatforms(
  platforms: readonly string[] | undefined,
  hostPlatforms: readonly string[] | undefined,
  host: string,
  path: string,
  manifest: PluginManifest,
  add: AddProblem
): void {
  const effective = platforms ?? manifest.platforms;
  const hostEffective = hostPlatforms ?? manifest.platforms;
  const allowed = new Set<string>(hostEffective);
  for (const platform of effective) {
    if (!allowed.has(platform)) {
      add(
        path,
        `"${platform}" is not one of the platforms its ${host} runs on (${hostEffective.join(", ")})`
      );
    }
  }
}

function collapseRenames(
  mapName: "commandRenames" | "rowRenames" | "buttonRenames",
  renames: Readonly<Record<string, string>> | undefined,
  declared: ReadonlySet<string>,
  kind: string,
  manifest: PluginManifest,
  add: AddProblem
): void {
  if (renames === undefined) return;
  try {
    const collapsed = collapseContributionRenames(renames, declared, kind);
    manifest[mapName] = { ...collapsed };
  } catch (error) {
    if (error instanceof PluginRenameError) {
      // A cycle spans several ids, so it belongs to the map, not one entry.
      add(error.problem === "cycle" ? mapName : `${mapName}.${error.from}`, error.message);
      return;
    }
    add(mapName, error instanceof Error ? error.message : String(error));
  }
}

function collectProblems(
  manifest: PluginManifest,
  options: ManifestValidationOptions
): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const add: AddProblem = (path, message) => {
    problems.push({ path, message });
  };
  if (manifest.warmStart === "intent" && manifest.lifecycle !== "on-demand") {
    add("warmStart", 'warmStart: "intent" applies only to an on-demand Plugin');
  }

  const required = manifest.permissions.required;
  const optional = manifest.permissions.optional;
  const seenRequired = new Set<string>();
  const seenOptional = new Set<string>();
  required.forEach((permission, index) => {
    const problem = permissionProblem(permission);
    if (problem !== null) add(`permissions.required[${index}]`, problem);
    else if (seenRequired.has(permission)) {
      add(`permissions.required[${index}]`, `duplicate Plugin Permission "${permission}"`);
    }
    seenRequired.add(permission);
  });
  optional.forEach((permission, index) => {
    const problem = permissionProblem(permission);
    if (problem !== null) {
      add(`permissions.optional[${index}]`, problem);
      return;
    }
    if (seenRequired.has(permission)) {
      add(
        `permissions.optional[${index}]`,
        `"${permission}" is listed as both required and optional`
      );
      return;
    }
    if (seenOptional.has(permission)) {
      add(`permissions.optional[${index}]`, `duplicate Plugin Permission "${permission}"`);
    }
    seenOptional.add(permission);
  });

  if (parseSemver(manifest.version) === null) {
    add("version", `"${manifest.version}" is not a semver version`);
  }
  if (manifest.minAppVersion !== undefined && parseSemver(manifest.minAppVersion) === null) {
    add("minAppVersion", `"${manifest.minAppVersion}" is not a semver version`);
  }
  if (!isValidRange(manifest.apiVersion)) {
    add(
      "apiVersion",
      `"${manifest.apiVersion}" is not a supported semver range (for example ^0.3 or >=0.3.0 <0.5.0)`
    );
  }
  if (manifest.homepage !== undefined && !isHttpUrl(manifest.homepage)) {
    add("homepage", "must be an http(s) URL");
  }
  const entryIssue = entryProblem(manifest.entry);
  if (entryIssue !== null) add("entry", entryIssue);

  if (new Set(manifest.platforms).size !== manifest.platforms.length) {
    add("platforms", "must not list a platform twice");
  }

  const contributes = manifest.contributes;
  const commands = contributes?.commands ?? [];
  const pages = contributes?.pages ?? [];
  const settingsRows = contributes?.settingsRows ?? [];
  const toolbarButtons = contributes?.toolbarButtons ?? [];
  const sidebarEntries = contributes?.sidebarEntries ?? [];
  const itemMenuEntries = contributes?.itemMenuEntries ?? [];
  const commandById = new Map(commands.map((command) => [command.id, command]));
  const pageIds = new Set(pages.map((page) => page.id));
  const pageById = new Map(pages.map((page) => [page.id, page]));

  const checkCount = <K extends keyof typeof CONTRIBUTION_LIMITS>(
    kind: K,
    list: readonly unknown[]
  ): void => {
    const limit = CONTRIBUTION_LIMITS[kind];
    if (list.length > limit) {
      add(`contributes.${kind}`, `at most ${limit} ${kind} are allowed`);
    }
  };
  checkCount("commands", commands);
  checkCount("pages", pages);
  checkCount("sidebarEntries", sidebarEntries);
  checkCount("settingsRows", settingsRows);
  checkCount("toolbarButtons", toolbarButtons);
  checkCount("itemMenuEntries", itemMenuEntries);

  checkDuplicateIds(commands, "contributes.commands", "Command", add);
  commands.forEach((command, commandIndex) => {
    const base = `contributes.commands[${commandIndex}]`;
    const seenContexts = new Set<string>();
    command.contexts.forEach((context, contextIndex) => {
      const contextPath = `${base}.contexts[${contextIndex}]`;
      if (!isCoreContextName(context) && !pageIds.has(context)) {
        add(contextPath, `"${context}" is not a core Shortcut Context or a declared page`);
      } else if (seenContexts.has(context)) {
        add(contextPath, `duplicate Shortcut Context "${context}"`);
      }
      seenContexts.add(context);
    });
    command.defaults?.forEach((shortcut, index) => {
      checkShortcutSteps(shortcut, `${base}.defaults[${index}]`, false, add);
    });
    command.web?.forEach((shortcut, index) => {
      checkShortcutSteps(shortcut, `${base}.web[${index}]`, true, add);
    });
    if (command.targets !== undefined) {
      const seen = new Set<string>();
      command.targets.forEach((target, targetIndex) => {
        if (seen.has(target)) {
          add(`${base}.targets[${targetIndex}]`, `duplicate target "${target}"`);
        }
        seen.add(target);
      });
    }
    if (command.voice?.phrases !== undefined) {
      for (const language of MANIFEST_LANGUAGES) {
        const phrases = command.voice.phrases[language];
        if (phrases !== undefined) {
          checkVoicePhrases(phrases, `${base}.voice.phrases.${language}`, add);
        }
      }
    }
    checkContributionPlatforms(command.platforms, `${base}.platforms`, manifest, add);
  });

  checkDuplicateIds(pages, "contributes.pages", "page", add);
  pages.forEach((page, index) => {
    const base = `contributes.pages[${index}]`;
    if (isReservedContextName(page.id)) {
      add(`${base}.id`, `"${page.id}" is a Shortcut Context name and cannot be a page id`);
    }
    const command = commandById.get(page.command);
    if (command === undefined) {
      add(`${base}.command`, `"${page.command}" must name a declared Command`);
    } else {
      if (command.navigates !== true) {
        add(`${base}.command`, `"${page.command}" must declare navigates: true to open a page`);
      }
      checkReferencePlatforms(
        page.platforms,
        command.platforms,
        "Command",
        `${base}.command`,
        manifest,
        add
      );
    }
    checkContributionPlatforms(page.platforms, `${base}.platforms`, manifest, add);
    if (page.frame !== undefined) {
      const frameIssue = frameProblem(page.frame);
      if (frameIssue !== null) {
        add(`${base}.frame`, frameIssue);
      } else {
        if (manifest.customUi !== true) {
          add(`${base}.frame`, "frame requires customUi: true on the manifest");
        }
        const files = options.files;
        if (files !== undefined) {
          const normalized = normalizeRelativePath(page.frame);
          if (!files.includes(normalized)) {
            add(`${base}.frame`, `frame "${page.frame}" is not a file in the Plugin folder`);
          }
        }
      }
    }
  });

  const seenSidebarPages = new Set<string>();
  sidebarEntries.forEach((entry, index) => {
    const base = `contributes.sidebarEntries[${index}]`;
    const page = pageById.get(entry.page);
    if (page === undefined) {
      add(`${base}.page`, `"${entry.page}" must name a declared page`);
    } else if (seenSidebarPages.has(entry.page)) {
      add(`${base}.page`, `duplicate sidebar entry for page "${entry.page}"`);
    } else {
      checkReferencePlatforms(
        entry.platforms,
        page.platforms,
        "page",
        `${base}.page`,
        manifest,
        add
      );
    }
    seenSidebarPages.add(entry.page);
    const iconIssue = iconProblem(entry.icon);
    if (iconIssue !== null) add(`${base}.icon`, iconIssue);
    checkContributionPlatforms(entry.platforms, `${base}.platforms`, manifest, add);
  });

  checkDuplicateIds(settingsRows, "contributes.settingsRows", "Settings row", add);
  settingsRows.forEach((row, index) => {
    checkContributionPlatforms(
      row.platforms,
      `contributes.settingsRows[${index}].platforms`,
      manifest,
      add
    );
  });

  checkDuplicateIds(toolbarButtons, "contributes.toolbarButtons", "toolbar button", add);
  toolbarButtons.forEach((button, index) => {
    const base = `contributes.toolbarButtons[${index}]`;
    const command = commandById.get(button.command);
    if (command === undefined) {
      add(`${base}.command`, `"${button.command}" must name a declared Command`);
    } else {
      checkReferencePlatforms(
        button.platforms,
        command.platforms,
        "Command",
        `${base}.command`,
        manifest,
        add
      );
    }
    const iconIssue = iconProblem(button.icon);
    if (iconIssue !== null) add(`${base}.icon`, iconIssue);
    checkContributionPlatforms(button.platforms, `${base}.platforms`, manifest, add);
  });

  const seenMenuCommands = new Set<string>();
  itemMenuEntries.forEach((entry, index) => {
    const base = `contributes.itemMenuEntries[${index}]`;
    const command = commandById.get(entry.command);
    if (command === undefined) {
      add(`${base}.command`, `"${entry.command}" must name a declared Command`);
    } else {
      if ((command.targets?.length ?? 0) === 0) {
        add(
          `${base}.command`,
          `"${entry.command}" must declare targets before it can join an Item Menu`
        );
      } else if (seenMenuCommands.has(entry.command)) {
        add(`${base}.command`, `duplicate Item Menu entry for Command "${entry.command}"`);
      }
      checkReferencePlatforms(
        entry.platforms,
        command.platforms,
        "Command",
        `${base}.command`,
        manifest,
        add
      );
    }
    seenMenuCommands.add(entry.command);
    checkContributionPlatforms(entry.platforms, `${base}.platforms`, manifest, add);
  });

  collapseRenames(
    "commandRenames",
    manifest.commandRenames,
    new Set(commands.map((command) => command.id)),
    "Command",
    manifest,
    add
  );
  collapseRenames(
    "rowRenames",
    manifest.rowRenames,
    new Set(settingsRows.map((row) => row.id)),
    "row",
    manifest,
    add
  );
  collapseRenames(
    "buttonRenames",
    manifest.buttonRenames,
    new Set(toolbarButtons.map((button) => button.id)),
    "button",
    manifest,
    add
  );

  // The decision's "default 1": consumers read the validated manifest, not the
  // authored file, so the absent field becomes explicit here.
  if (manifest.dataVersion === undefined) manifest.dataVersion = 1;

  return problems;
}

/** Validates an already-parsed manifest value. Rename maps come back collapsed. */
export function validateManifestValue(
  value: unknown,
  options: ManifestValidationOptions = {}
): ManifestValidation {
  const schema = options.builtIn ? builtInPluginManifestSchema : pluginManifestSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, problems: problemsFromZod(parsed.error) };
  }
  const manifest: PluginManifest = parsed.data;
  const problems = collectProblems(manifest, options);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, manifest };
}

/** Validates the text of `manifest.json`: the size cap, JSON, and every rule. */
export function parsePluginManifest(
  text: string,
  options: ManifestValidationOptions = {}
): ManifestValidation {
  const bytes = utf8Bytes(text);
  if (bytes > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      problems: [
        {
          path: "",
          message: `manifest.json must be at most 64 KB (found ${bytes} bytes)`,
        },
      ],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      problems: [{ path: "", message: `manifest.json is not valid JSON: ${detail}` }],
    };
  }
  return validateManifestValue(value, options);
}

/**
 * Validates one `locales/<lang>.json` file against its manifest. Every key is a
 * field path into the manifest (`commands.showReport.label`); a path to a
 * field that does not exist there, or a value of the wrong kind, is refused.
 */
export function parsePluginLocale(
  text: string,
  language: string,
  manifest: PluginManifest
): LocaleValidation {
  const problems: ManifestProblem[] = [];
  if (!(MANIFEST_LANGUAGES as readonly string[]).includes(language)) {
    problems.push({ path: "", message: `"${language}" is not a supported Plugin language` });
  }
  const bytes = utf8Bytes(text);
  if (bytes > MAX_LOCALE_BYTES) {
    problems.push({
      path: "",
      message: `a locale file must be at most 64 KB (found ${bytes} bytes)`,
    });
    return { ok: false, problems };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    problems.push({ path: "", message: `a locale file is not valid JSON: ${detail}` });
    return { ok: false, problems };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    problems.push({ path: "", message: "a locale file must be a JSON object of field paths" });
    return { ok: false, problems };
  }

  const locale: Record<string, string | readonly string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith("x-")) continue;
    const field = localeField(key, manifest);
    if (field === null) {
      problems.push({
        path: key,
        message: `"${key}" does not name a localizable field of this manifest`,
      });
      continue;
    }
    if (field.kind === "string") {
      if (typeof value !== "string" || value.trim() === "") {
        problems.push({ path: key, message: "must be a non-empty string" });
        continue;
      }
      locale[key] = value;
      continue;
    }
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || item.trim() === "")
    ) {
      problems.push({ path: key, message: "must be an array of non-empty strings" });
      continue;
    }
    locale[key] = value as string[];
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, locale };
}
