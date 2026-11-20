import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginLocale, parsePluginManifest } from "@/features/plugins/manifest-validate";

// The Clock manifest: persistent on desktop, web, and Android, asking only for
// System Notifications, with the Open Clock page Command and the Start or pause
// the Timer Command. The host pre-grants a Built-in's permissions and still
// leaves it off until the author turns it on, so nothing here declares that.
describe("Clock manifest", () => {
  const text = readFileSync(join(__dirname, "manifest.json"), "utf8");

  function manifest() {
    const result = parsePluginManifest(text, { builtIn: true });
    if (!result.ok) throw new Error(JSON.stringify(result.problems));
    return result.manifest;
  }

  it("passes Built-in Plugin manifest validation", () => {
    const result = parsePluginManifest(text, { builtIn: true });
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("identifies the Plugin as maibuk-clock", () => {
    expect(manifest().id).toBe("maibuk-clock");
    expect(manifest().name).toBe("Clock");
  });

  it("runs persistent on desktop, web, and Android", () => {
    expect(manifest().platforms).toEqual(["desktop", "web", "android"]);
    expect(manifest().lifecycle).toBe("persistent");
  });

  it("asks only for System Notifications", () => {
    expect(manifest().permissions.required).toEqual(["system-notifications"]);
    expect(manifest().permissions.optional).toEqual([]);
  });

  it("opens the Clock page from a navigating Command behind a sidebar entry", () => {
    const contributes = manifest().contributes;
    const open = contributes?.commands?.find((command) => command.id === "openClock");
    expect(open?.label).toBe("Open Clock");
    expect(open?.contexts).toEqual(["global"]);
    expect(open?.navigates).toBe(true);
    expect(open?.defaults).toBeUndefined();
    const page = contributes?.pages?.find((candidate) => candidate.id === "clock");
    expect(page?.title).toBe("Clock");
    expect(page?.command).toBe("openClock");
    expect(contributes?.sidebarEntries?.find((entry) => entry.page === "clock")?.icon).toBe(
      "timer"
    );
  });

  it("contributes the toggleTimer Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "toggleTimer"
    );
    expect(command?.label).toBe("Start or pause the Timer");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
    expect(command?.navigates).toBeUndefined();
  });

  it("contributes exactly the two Commands, in order", () => {
    expect(manifest().contributes?.commands?.map((command) => command.id)).toEqual([
      "openClock",
      "toggleTimer",
    ]);
  });

  it("localizes its host-visible strings through locales/<lang>.json", () => {
    const parsed = manifest();
    const locale = readFileSync(join(__dirname, "locales", "es.json"), "utf8");
    const result = parsePluginLocale(locale, "es", parsed);
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("localizes the name, both Command labels, and the page title in Spanish", () => {
    const locale = JSON.parse(readFileSync(join(__dirname, "locales", "es.json"), "utf8"));
    expect(locale.name).toBe("Reloj");
    expect(locale["commands.openClock.label"]).toBe("Abrir Reloj");
    expect(locale["commands.toggleTimer.label"]).toBe("Iniciar o pausar el temporizador");
    expect(locale["pages.clock.title"]).toBe("Reloj");
  });
});
