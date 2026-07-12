import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import es from "@/locales/es.json";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("toolbar settings i18n", () => {
  it("defines toolbar.settings in both locales", () => {
    expect(en.toolbar.settings).toBeDefined();
    expect(es.toolbar.settings).toBeDefined();
  });

  it("has identical key structure for toolbar.settings in en and es", () => {
    const enKeys = keyPaths(en.toolbar.settings).sort();
    const esKeys = keyPaths(es.toolbar.settings).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("includes all new column header and help keys", () => {
    const settings = en.toolbar.settings;
    const expectedKeys = [
      "itemColumn",
      "itemColumnHelp",
      "toolbarColumn",
      "toolbarColumnHelp",
      "selectionMenuColumn",
      "selectionMenuColumnHelp",
      "orderColumn",
      "orderColumnHelp",
      "sectionColumn",
      "sectionColumnHelp",
      "actionsColumn",
      "actionsColumnHelp",
    ];
    for (const key of expectedKeys) {
      expect((settings as Record<string, string>)[key]).toBeTruthy();
      expect((es.toolbar.settings as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it("retains the required control label keys used by tooltips and aria-labels", () => {
    const settings = en.toolbar.settings;
    const requiredKeys = [
      "toolbarVisible",
      "floatingVisible",
      "floatingUnavailable",
      "addDivider",
      "remove",
      "moveUp",
      "moveDown",
      "transferToStart",
      "transferToEnd",
      "dragHandle",
    ];
    for (const key of requiredKeys) {
      expect((settings as Record<string, string>)[key]).toBeTruthy();
      expect((es.toolbar.settings as Record<string, string>)[key]).toBeTruthy();
    }
  });
});
