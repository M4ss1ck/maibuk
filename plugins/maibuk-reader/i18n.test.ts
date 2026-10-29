/**
 * Reader's strings (#653): the runtime catalog the Shelf draws from and the
 * manifest locales the host applies. English and Spanish ship the same keys,
 * every host-visible manifest field has a translation, and no value is empty.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";
import { format, translate } from "./i18n";
import en from "./locales/en.json";
import es from "./locales/es.json";
import runtimeEn from "./locales/runtime/en.json";
import runtimeEs from "./locales/runtime/es.json";

describe("runtime catalog", () => {
  it("shares every key between en and es, with no empty value", () => {
    const enKeys = Object.keys(runtimeEn).sort();
    const esKeys = Object.keys(runtimeEs).sort();
    expect(esKeys).toEqual(enKeys);
    for (const [key, value] of Object.entries(runtimeEn)) {
      expect(value.trim(), `en ${key}`).not.toBe("");
      expect((runtimeEs as Record<string, string>)[key]?.trim(), `es ${key}`).not.toBe("");
    }
  });

  it("looks strings up in the signaled language, following the base subtag", () => {
    expect(translate("en", "shelf.openFile")).toBe("Open file…");
    expect(translate("es", "shelf.openFile")).toBe("Abrir archivo…");
    expect(translate("es-MX", "shelf.open")).toBe("Abrir");
    expect(translate("fr", "shelf.open")).toBe("Open");
  });

  it("fills placeholders", () => {
    expect(format(translate("en", "shelf.progress.page"), { page: 34, count: 210 })).toBe(
      "p. 34 of 210"
    );
    expect(format(translate("es", "shelf.progress.page"), { page: 34, count: 210 })).toBe(
      "pág. 34 de 210"
    );
    expect(format(translate("en", "shelf.progress.percent"), { percent: 42 })).toBe("42%");
  });
});

describe("manifest locales", () => {
  const manifest = (() => {
    const text = readFileSync(join(__dirname, "manifest.json"), "utf8");
    const result = parsePluginManifest(text, { builtIn: true });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.manifest;
  })();

  it("is valid for both languages", () => {
    for (const language of ["en", "es"] as const) {
      const raw = readFileSync(join(__dirname, "locales", `${language}.json`), "utf8");
      const result = parsePluginLocale(raw, language, manifest);
      expect(result.ok ? [] : result.problems, language).toEqual([]);
    }
  });

  it("shares every key between en and es, with no empty value", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en ${key}`).not.toBe("");
      expect((es as Record<string, string>)[key]?.trim(), `es ${key}`).not.toBe("");
    }
  });

  it("localizes every label the host can show", () => {
    const keys = [
      "name",
      "description",
      ...(manifest.contributes?.commands ?? []).map((command) => `commands.${command.id}.label`),
      ...(manifest.contributes?.pages ?? []).map((page) => `pages.${page.id}.title`),
    ];
    for (const key of keys) {
      expect((en as Record<string, string>)[key], `en ${key}`).toBeTruthy();
      expect((es as Record<string, string>)[key], `es ${key}`).toBeTruthy();
    }
  });
});
