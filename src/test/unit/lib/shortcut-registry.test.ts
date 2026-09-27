import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_COMMANDS } from "@/components/editor/editor-commands";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import {
  COMMAND_IDS,
  COMMAND_RENAMES,
  COMMANDS,
  ROUTE_CONTEXTS,
  SHORTCUT_SECTIONS,
  commandSection,
  type CommandDef,
  type ShortcutContext,
} from "@/lib/shortcut-registry";
import { normalizeShortcut } from "@/lib/shortcut-keys";
import { findDefaultConflicts } from "@/lib/shortcut-resolve";

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
    else expect(definition.contexts).toEqual([prefix]);
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
