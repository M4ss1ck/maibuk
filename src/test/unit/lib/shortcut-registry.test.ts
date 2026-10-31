import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EDITOR_COMMANDS } from "@/components/editor/editor-commands";
import { parsePluginManifest } from "@/features/plugins/manifest-validate";
import type { PluginManifest } from "@/features/plugins/types";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  COMMAND_IDS,
  COMMAND_RENAMES,
  COMMANDS,
  ROUTE_CONTEXTS,
  SHORTCUT_SECTIONS,
  commandSection,
  registerPluginCommands,
  type CommandDef,
  type ShortcutContext,
} from "@/lib/shortcut-registry";
import { normalizeShortcut } from "@/lib/shortcut-keys";
import {
  defaultShortcuts,
  effectiveShortcuts,
  findConflicts,
  findDefaultConflicts,
} from "@/lib/shortcut-resolve";

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, messages);
}

const ALL_CONTEXTS: ShortcutContext[] = [
  "global",
  "bookList",
  "bookEditor",
  "coverDesigner",
  "notes",
  "canvas",
  "ephemeral",
  "editor",
  "noteItem",
  "chapterItem",
  "canvasNode",
  "image",
  "footnoteItem",
];

describe("command registry", () => {
  it.each(COMMAND_IDS)("%s has a label in both locales", (id) => {
    const { labelKey } = COMMANDS[id] as CommandDef;
    expect(typeof lookup(en, labelKey)).toBe("string");
    expect(typeof lookup(es, labelKey)).toBe("string");
  });

  it.each(COMMAND_IDS)("%s names a Context its prefix agrees with", (id) => {
    const definition: CommandDef = COMMANDS[id];
    const prefix = id.split(".")[0];
    expect(definition.contexts.length).toBeGreaterThan(0);
    if (prefix === "common") expect(definition.contexts.length).toBeGreaterThan(1);
    else if (prefix === "tutorial") expect(definition.contexts).toEqual(["global"]);
    // Focus is a help section, not a Context: its Commands are global.
    else if (prefix === "focus") expect(definition.contexts).toEqual(["global"]);
    // Dictation is a feature, not a Context: its Commands are global or editor.
    else if (prefix === "dictation") {
      for (const context of definition.contexts) expect(["global", "editor"]).toContain(context);
    } else expect(definition.contexts).toEqual([prefix]);
  });

  it.each(COMMAND_IDS)("%s writes every Shortcut in canonical form", (id) => {
    const definition: CommandDef = COMMANDS[id];
    const all = [...definition.defaults, ...(definition.fixed ?? []), ...(definition.web ?? [])];
    for (const shortcut of all) expect(normalizeShortcut(shortcut)).toEqual(shortcut);
  });

  it("gives a Sealed Command Fixed Shortcuts only, and every Fixed Shortcut a reason", () => {
    for (const id of COMMAND_IDS) {
      const definition: CommandDef = COMMANDS[id];
      if (definition.sealed) {
        expect(definition.defaults, id).toEqual([]);
        expect(definition.fixed?.length, id).toBeGreaterThan(0);
      }
      if (definition.fixed) {
        expect(typeof lookup(en, definition.fixedReasonKey ?? ""), id).toBe("string");
        expect(typeof lookup(es, definition.fixedReasonKey ?? ""), id).toBe("string");
      }
    }
  });

  it("ships no Default Shortcut that conflicts with another on desktop or web", () => {
    expect(findDefaultConflicts(false)).toEqual([]);
    expect(findDefaultConflicts(true)).toEqual([]);
  });

  it("opens the Command Palette with F1 and Mod+Shift+P on desktop, F1 only on web", () => {
    expect(effectiveShortcuts("global.openCommandPalette", {}, false)).toEqual([
      ["F1"],
      ["Mod+Shift+p"],
    ]);
    expect(effectiveShortcuts("global.openCommandPalette", {}, true)).toEqual([["F1"]]);
  });

  it("keeps Always on Top on Mod+Alt+T on desktop and web", () => {
    expect(effectiveShortcuts("global.toggleAlwaysOnTop", {}, false)).toEqual([["Mod+Alt+t"]]);
    expect(effectiveShortcuts("global.toggleAlwaysOnTop", {}, true)).toEqual([["Mod+Alt+t"]]);
  });

  it("lists the commandPalette Context on every route except /embed", () => {
    for (const [route, contexts] of Object.entries(ROUTE_CONTEXTS)) {
      if (route === "/embed") expect(contexts).toEqual([]);
      else expect(contexts, route).toContain("commandPalette");
    }
  });

  it("declares the Contexts of every route in App.tsx", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) =>
      match[1].startsWith("/") ? match[1] : `/${match[1]}`
    );
    expect(paths.length).toBeGreaterThan(0);
    expect(Object.keys(ROUTE_CONTEXTS).sort()).toEqual([...new Set(paths)].sort());
  });

  it("shows every Context on some route, and each in exactly one section", () => {
    const shown = new Set(Object.values(ROUTE_CONTEXTS).flat());
    for (const context of ALL_CONTEXTS) {
      if (context !== "global") expect(shown.has(context), context).toBe(true);
      const sections = SHORTCUT_SECTIONS.filter((section) =>
        (section.contexts as readonly ShortcutContext[]).includes(context)
      );
      expect(sections, context).toHaveLength(1);
    }
    for (const section of SHORTCUT_SECTIONS) {
      expect(typeof lookup(en, section.labelKey), section.id).toBe("string");
      expect(typeof lookup(es, section.labelKey), section.id).toBe("string");
    }
  });

  it("files Shared Commands under Common and the rest under their Context's section", () => {
    expect(commandSection("common.save")).toBe("common");
    expect(commandSection("editor.bold")).toBe("editor");
    expect(commandSection("tutorial.skip")).toBe("global");
    expect(commandSection("coverDesigner.duplicate")).toBe("coverDesigner");
    expect(commandSection("focus.next")).toBe("focus");
  });

  it("renames only to Commands that exist", () => {
    for (const [from, to] of Object.entries(COMMAND_RENAMES)) {
      expect(COMMAND_IDS).toContain(to);
      expect(COMMAND_IDS).not.toContain(from);
    }
  });

  it("implements every Command handled by the editor keymap", () => {
    for (const id of COMMAND_IDS) {
      if ((COMMANDS[id] as CommandDef).source === "editor-keymap") {
        expect(EDITOR_COMMANDS[id], id).toBeTypeOf("function");
      }
    }
  });
});

/**
 * The Built-in Plugin manifests (#451): their Commands' Default Shortcuts are
 * the Plugin's own, so `findDefaultConflicts` deliberately ignores them (they
 * go inactive on a clash, ADR 0024). A Built-in still ships keys its authors
 * proved free (decision 5), so this gate registers every shipped manifest and
 * refuses a Default Shortcut that clashes with the core registry or another
 * Built-in on either the desktop or the web build.
 */
describe("built-in Plugin manifest Default Shortcuts", () => {
  const PLUGINS_DIR = join(process.cwd(), "plugins");
  const unregisters: Array<() => void> = [];
  afterEach(() => {
    while (unregisters.length > 0) unregisters.pop()?.();
  });

  /** Every Built-in Plugin folder's manifest, parsed with the host's Built-in rules. */
  function builtInManifests(): PluginManifest[] {
    return readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(PLUGINS_DIR, entry.name, "manifest.json"))
      )
      .map((entry) => {
        const text = readFileSync(join(PLUGINS_DIR, entry.name, "manifest.json"), "utf8");
        const result = parsePluginManifest(text, { builtIn: true });
        if (!result.ok) throw new Error(`${entry.name}: ${JSON.stringify(result.problems)}`);
        return result.manifest;
      });
  }

  it("ships Echoes among the manifests it checks", () => {
    expect(builtInManifests().map((manifest) => manifest.id)).toContain("maibuk-echoes");
  });

  it("ships no Default Shortcut that conflicts on desktop or web", () => {
    const manifests = builtInManifests();
    for (const manifest of manifests) {
      const commands = manifest.contributes?.commands ?? [];
      const pages = (manifest.contributes?.pages ?? []).map((page) => page.id);
      unregisters.push(
        registerPluginCommands(manifest.id, {
          defaultLanguage: manifest.defaultLanguage,
          commands: commands.map((command) => ({
            id: command.id,
            label: command.label,
            contexts: command.contexts,
            ...(command.defaults !== undefined ? { defaults: command.defaults } : {}),
            ...(command.web !== undefined ? { web: command.web } : {}),
          })),
          ...(pages.length > 0 ? { pages } : {}),
        })
      );
    }

    const conflicts: string[] = [];
    let checked = 0;
    for (const manifest of manifests) {
      for (const command of manifest.contributes?.commands ?? []) {
        const id = `plugin.${manifest.id}.${command.id}` as const;
        for (const web of [false, true]) {
          for (const shortcut of defaultShortcuts(id, web)) {
            checked += 1;
            for (const conflict of findConflicts(id, shortcut, {}, web)) {
              conflicts.push(
                `${id} ${shortcut.join("+")} (${web ? "web" : "desktop"}) clashes with ${conflict.id}`
              );
            }
          }
        }
      }
    }
    // Echoes' three editor Commands each ship one Default Shortcut on both builds.
    expect(checked).toBeGreaterThanOrEqual(6);
    expect(conflicts).toEqual([]);
  });
});
