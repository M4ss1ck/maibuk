import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

// The Plugin management copy (#443): the prototype's approved `words`
// dictionary (docs/plans/plugin-management-443.prototype.html), minus the
// prototype-only keys, plus the filter control name and the Command labels.

type Leaf = readonly [path: string, value: string];

function collectLeaves(node: unknown, prefix = ""): Leaf[] {
  if (typeof node === "string") return [[prefix, node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) =>
    collectLeaves(value, prefix ? `${prefix}.${key}` : key)
  );
}

// A Plugin is never an "extension", "add-on", or "mod".
const FORBIDDEN = /extension|add-on|\bmod\b/i;

describe("Plugin management copy", () => {
  it("has the same plugins.management keys in both locales", () => {
    const enKeys = collectLeaves(en.plugins.management).map(([path]) => path);
    const esKeys = collectLeaves(es.plugins.management).map(([path]) => path);
    expect(enKeys.length).toBeGreaterThan(0);
    expect(esKeys.sort()).toEqual(enKeys.sort());
  });

  it("is non-empty in both locales", () => {
    for (const locale of [en, es]) {
      for (const [path, value] of collectLeaves(locale.plugins.management)) {
        expect(value.trim().length, path).toBeGreaterThan(0);
      }
    }
  });

  it("uses Plugin terms only", () => {
    for (const locale of [en, es]) {
      for (const [path, value] of collectLeaves(locale.plugins.management)) {
        expect(FORBIDDEN.test(value), path).toBe(false);
      }
    }
  });

  it("carries the filter control name and categories in both locales", () => {
    for (const locale of [en, es]) {
      expect(locale.plugins.management.filters.label.length).toBeGreaterThan(0);
      for (const key of [
        "installed",
        "available",
        "builtIn",
        "disabled",
        "removed",
        "unsupported",
      ] as const) {
        expect(locale.plugins.management.filters[key].length, key).toBeGreaterThan(0);
      }
    }
    expect(en.plugins.management.filters.label).toBe("Filter by status");
    expect(es.plugins.management.filters.label).toBe("Filtrar por estado");
    expect(en.plugins.management.filters.builtIn).toBe("Built-in");
    expect(es.plugins.management.filters.builtIn).toBe("Integrado");
  });

  it("carries the Command labels in both locales", () => {
    expect(en.plugins.management.commands.addPlugin).toBe("Add Plugin");
    expect(es.plugins.management.commands.addPlugin).toBe("Añadir Plugin");
    expect(en.plugins.management.commands.openDirectory).toBe("Open Plugin Directory");
    expect(es.plugins.management.commands.openDirectory).toBe("Abrir carpeta de Plugins");
    expect(en.plugins.management.commands.changeDirectory).toBe("Change Plugin Directory");
    expect(es.plugins.management.commands.changeDirectory).toBe("Cambiar carpeta de Plugins");
  });
});
