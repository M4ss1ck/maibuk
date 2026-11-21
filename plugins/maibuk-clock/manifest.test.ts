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

  it("draws the Clock page in its Frame with the host's title hidden", () => {
    expect(manifest().customUi).toBe(true);
    const page = manifest().contributes?.pages?.find((candidate) => candidate.id === "clock");
    expect(page?.frame).toBe("assets/ui/clock.html");
    expect(page?.hideTitle).toBe(true);
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

  it("contributes the togglePomodoro Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "togglePomodoro"
    );
    expect(command?.label).toBe("Start or pause the Pomodoro");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
    expect(command?.navigates).toBeUndefined();
  });

  it("contributes the skipPomodoro Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "skipPomodoro"
    );
    expect(command?.label).toBe("Skip to the next Pomodoro or break");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
    expect(command?.navigates).toBeUndefined();
  });

  it("contributes the toggleStopwatch Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "toggleStopwatch"
    );
    expect(command?.label).toBe("Start or pause the Stopwatch");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
    expect(command?.navigates).toBeUndefined();
  });

  it("contributes the lapStopwatch Command with no default shortcut", () => {
    const command = manifest().contributes?.commands?.find(
      (candidate) => candidate.id === "lapStopwatch"
    );
    expect(command?.label).toBe("Mark a Lap");
    expect(command?.contexts).toEqual(["global"]);
    expect(command?.defaults).toBeUndefined();
    expect(command?.navigates).toBeUndefined();
  });

  it("contributes the Pomodoro toggle as a Toggle Button", () => {
    expect(manifest().contributes?.toolbarButtons).toEqual([
      {
        id: "togglePomodoro",
        command: "togglePomodoro",
        icon: {
          elements: [
            ["line", { x1: "10", y1: "2", x2: "14", y2: "2" }],
            ["line", { x1: "12", y1: "14", x2: "15", y2: "11" }],
            ["circle", { cx: "12", cy: "14", r: "8" }],
          ],
        },
        toggle: true,
      },
    ]);
  });

  it("declares the Pomodoro Settings row", () => {
    expect(manifest().contributes?.settingsRows).toEqual([
      {
        id: "pomodoro",
        label: "Pomodoro",
        description: "Set how long Pomodoros and breaks last, and whether they start on their own.",
      },
    ]);
  });

  it("contributes exactly the six Commands, in order", () => {
    expect(manifest().contributes?.commands?.map((command) => command.id)).toEqual([
      "openClock",
      "toggleTimer",
      "togglePomodoro",
      "skipPomodoro",
      "toggleStopwatch",
      "lapStopwatch",
    ]);
  });

  it("localizes its host-visible strings through locales/<lang>.json", () => {
    const parsed = manifest();
    const locale = readFileSync(join(__dirname, "locales", "es.json"), "utf8");
    const result = parsePluginLocale(locale, "es", parsed);
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it("localizes the name, every Command label, and the page title in Spanish", () => {
    const locale = JSON.parse(readFileSync(join(__dirname, "locales", "es.json"), "utf8"));
    expect(locale.name).toBe("Reloj");
    expect(locale["commands.openClock.label"]).toBe("Abrir Reloj");
    expect(locale["commands.toggleTimer.label"]).toBe("Iniciar o pausar el temporizador");
    expect(locale["commands.togglePomodoro.label"]).toBe("Iniciar o pausar el Pomodoro");
    expect(locale["commands.skipPomodoro.label"]).toBe("Saltar al siguiente Pomodoro o descanso");
    expect(locale["commands.toggleStopwatch.label"]).toBe("Iniciar o pausar el cronómetro");
    expect(locale["commands.lapStopwatch.label"]).toBe("Marcar una vuelta");
    expect(locale["pages.clock.title"]).toBe("Reloj");
    expect(locale["settingsRows.pomodoro.label"]).toBe("Pomodoro");
    expect(locale["settingsRows.pomodoro.description"]).toBe(
      "Elige cuánto duran los Pomodoros y los descansos, y si empiezan solos."
    );
  });
});
