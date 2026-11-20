/**
 * Clock's locales: the runtime catalogs the page reads and the manifest
 * overrides the host applies. English and Spanish must carry the same runtime
 * keys, and the Spanish overrides must name only fields this manifest declares,
 * so neither folder can drift into a missing or extra string.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";
import { translate } from "./i18n";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";

describe("Clock runtime catalogs", () => {
  it("ships the same keys in en and es", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("names every tab in both languages", () => {
    expect(translate("en", "pomodoro")).toBe("Pomodoro");
    expect(translate("en", "timer")).toBe("Timer");
    expect(translate("en", "stopwatch")).toBe("Stopwatch");
    expect(translate("en", "alarms")).toBe("Alarms");
    expect(translate("es", "pomodoro")).toBe("Pomodoro");
    expect(translate("es", "timer")).toBe("Temporizador");
    expect(translate("es", "stopwatch")).toBe("Cronómetro");
    expect(translate("es", "alarms")).toBe("Alarmas");
  });

  it("follows the base subtag and falls back to English", () => {
    expect(translate("es-MX", "timer")).toBe("Temporizador");
    expect(translate("fr", "timer")).toBe("Timer");
  });
});

describe("Clock manifest overrides", () => {
  const text = readFileSync(join(__dirname, "manifest.json"), "utf8");

  function manifest() {
    const result = parsePluginManifest(text, { builtIn: true });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.manifest;
  }

  it("overrides exactly the fields the English manifest declares", () => {
    const locale = JSON.parse(readFileSync(join(__dirname, "locales", "es.json"), "utf8"));
    expect(Object.keys(locale).sort()).toEqual([
      "commands.openClock.label",
      "commands.toggleTimer.label",
      "description",
      "name",
      "pages.clock.title",
    ]);
    const result = parsePluginLocale(JSON.stringify(locale), "es", manifest());
    expect(result.ok ? [] : result.problems).toEqual([]);
  });
});
