import { describe, expect, it } from "vitest";
import en from "../../../locales/en.json";
import es from "../../../locales/es.json";
import { PASTE_STRIP_COMMON_PROPERTIES } from "../../../features/settings/types";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("paste cleanup i18n", () => {
  it("defines settings.pasteCleanup in both locales", () => {
    expect(en.settings.pasteCleanup).toBeDefined();
    expect(es.settings.pasteCleanup).toBeDefined();
  });

  it("has identical key structure in en and es", () => {
    const enKeys = keyPaths(en.settings.pasteCleanup).sort();
    const esKeys = keyPaths(es.settings.pasteCleanup).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it("includes the expected preset, option, strip and rule keys", () => {
    const pc = en.settings.pasteCleanup;

    expect(pc.title).toBeTruthy();
    expect(pc.advanced).toBeTruthy();
    for (const preset of ["keepAll", "matchBook", "plainText", "custom"]) {
      expect((pc.preset as Record<string, string>)[preset]).toBeTruthy();
    }

    const optionKeys = [
      "demoteHeadings",
      "stripLinks",
      "flattenLists",
      "removeImages",
      "unwrapFormattingTags",
    ];
    for (const key of optionKeys) {
      expect((pc.option as Record<string, string>)[key]).toBeTruthy();
    }

    expect(pc.strip.title).toBeTruthy();
    expect(pc.strip.addProperty).toBeTruthy();

    for (const target of [
      "fontFamily",
      "textColor",
      "backgroundColor",
      "cssClass",
      "tag",
      "cssSelector",
    ]) {
      expect((pc.rules.targetOption as Record<string, string>)[target]).toBeTruthy();
    }
    for (const action of ["removeStyle", "unwrap", "delete"]) {
      expect((pc.rules.actionOption as Record<string, string>)[action]).toBeTruthy();
    }
  });

  it("labels every curated strip property in both locales", () => {
    for (const prop of PASTE_STRIP_COMMON_PROPERTIES) {
      expect((en.settings.pasteCleanup.property as Record<string, string>)[prop]).toBeTruthy();
      expect((es.settings.pasteCleanup.property as Record<string, string>)[prop]).toBeTruthy();
    }
  });
});
