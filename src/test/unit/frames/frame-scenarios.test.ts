// The frame-rate lane cannot drift silently (issue #372): every declared
// scenario names a seed Library that exists, a budget entry, and a driver,
// and nothing is budgeted or driven that is not declared. The scenarios
// themselves never run here; they run only through `pnpm bench:frames`.

import { describe, expect, it } from "vitest";
import { FRAME_BUDGETS } from "@/test/support/frames/budget";
import {
  FRAME_BENCH_USAGE,
  FrameBenchUsageError,
  parseFrameBenchArgs,
} from "@/test/support/frames/cli";
import { FRAME_SCENARIOS, scenariosFor } from "@/test/support/frames/scenarios";
// The @/ alias maps to src/, so e2e/ is out of reach; a relative path is the
// only way to import the lane's drivers and the seed registry.
import { FRAME_DRIVERS } from "../../../../e2e/frames/drivers";
import { SEED_LIBRARIES } from "../../../../e2e/support/seed/libraries";

const ids = FRAME_SCENARIOS.map((s) => s.id);

describe("frame scenarios", () => {
  it("have unique ids", () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(
    FRAME_SCENARIOS.map((s) => [s.id, s] as const)
  )("%s names an existing seed, a budget entry, and a driver", (_id, scenario) => {
    expect(Object.keys(SEED_LIBRARIES)).toContain(scenario.seed);
    expect(FRAME_BUDGETS[scenario.id]).toBeDefined();
    expect(FRAME_DRIVERS[scenario.id]).toBeDefined();
    expect(scenario.repetitions).toBeGreaterThanOrEqual(1);
  });

  it("budget and drive only declared scenarios", () => {
    expect(Object.keys(FRAME_BUDGETS).sort()).toEqual([...ids].sort());
    expect(Object.keys(FRAME_DRIVERS).sort()).toEqual([...ids].sort());
  });

  it("record keystrokes exactly where the budget judges keystroke to next frame", () => {
    for (const scenario of FRAME_SCENARIOS) {
      const judged = FRAME_BUDGETS[scenario.id].overrides.inputP95Intervals !== undefined;
      expect(scenario.recordsInput, scenario.id).toBe(judged);
    }
  });

  it("time arrow handlers exactly where the budget judges handler time", () => {
    for (const scenario of FRAME_SCENARIOS) {
      const judged = FRAME_BUDGETS[scenario.id].overrides.handlerP95Ms !== undefined;
      expect(typeof FRAME_DRIVERS[scenario.id].handlerSamples === "function", scenario.id).toBe(
        judged
      );
    }
  });

  it("judge the arrow leave on both long lists and the Pane slide by dropped frames", () => {
    expect(FRAME_BUDGETS["arrow-leave-notes"].overrides.handlerP95Ms).toBe(2);
    expect(FRAME_BUDGETS["arrow-leave-chapters"].overrides.handlerP95Ms).toBe(2);
    expect(FRAME_SCENARIOS.find((s) => s.id === "arrow-leave-notes")?.seed).toBe("perfManyNotes");
    expect(FRAME_SCENARIOS.find((s) => s.id === "arrow-leave-chapters")?.seed).toBe(
      "perfManyChapters"
    );
    expect(FRAME_BUDGETS["pane-slide"].overrides).toEqual({});
  });

  it("give every skipped source a reason, and the Android source a named seed", () => {
    for (const scenario of FRAME_SCENARIOS) {
      for (const reason of Object.values(scenario.skip ?? {})) {
        expect(reason?.length, scenario.id).toBeGreaterThan(20);
      }
    }
    // A seed file is what the Android source swaps into the test install.
    for (const scenario of scenariosFor("android")) {
      expect(scenario.seed, scenario.id).not.toBe("empty");
    }
  });

  it("list the Android subset explicitly", () => {
    expect(scenariosFor("android").map((s) => s.id)).toEqual([
      "typing",
      "scroll",
      "canvas",
      "chapter-reorder",
      "palette",
    ]);
  });

  it("scope the Plugin scenarios to the sources that can seed a Plugin Directory", () => {
    const pluginScenarios = FRAME_SCENARIOS.filter((s) => s.plugins !== undefined);
    expect(pluginScenarios.map((s) => s.id).sort()).toEqual([
      "plugin-remote-ui",
      "typing-with-echoes",
      "typing-with-highlights",
    ]);
    for (const scenario of pluginScenarios) {
      expect(scenario.plugins?.length, scenario.id).toBeGreaterThan(0);
      for (const plugin of scenario.plugins ?? []) {
        expect(["fixture-bench", "maibuk-echoes"], scenario.id).toContain(plugin.id);
        expect(plugin.granted.length, scenario.id).toBeGreaterThan(0);
      }
      // Seeding a Plugin writes the OPFS Plugin Directory, which the probe
      // (WebKit) and android sources lack: both must be skipped, with a reason.
      expect(scenario.skip?.probe, scenario.id).toBeTruthy();
      expect(scenario.skip?.android, scenario.id).toBeTruthy();
    }
    // The two fixture-bench scenarios grant the bench fixture's Permissions; the
    // Echoes scenario installs Echoes with its own.
    const byId = new Map(pluginScenarios.map((s) => [s.id, s]));
    for (const id of ["plugin-remote-ui", "typing-with-highlights"]) {
      expect(byId.get(id)?.plugins).toEqual([
        { id: "fixture-bench", granted: ["editor:read", "editor:decorate"] },
      ]);
    }
    expect(byId.get("typing-with-echoes")?.plugins).toEqual([
      {
        id: "maibuk-echoes",
        granted: ["library:read", "editor:read", "editor:decorate"],
        builtIn: true,
      },
    ]);
    // Remote UI rendering is scroll only; the typing scenarios record keys.
    expect(byId.get("plugin-remote-ui")?.recordsInput).toBe(false);
    expect(byId.get("typing-with-highlights")?.recordsInput).toBe(true);
    expect(byId.get("typing-with-echoes")?.recordsInput).toBe(true);
    for (const source of ["probe", "android"] as const) {
      const ids = scenariosFor(source).map((s) => s.id);
      expect(ids, source).not.toContain("plugin-remote-ui");
      expect(ids, source).not.toContain("typing-with-highlights");
      expect(ids, source).not.toContain("typing-with-echoes");
    }
  });
});

describe("parseFrameBenchArgs()", () => {
  it("defaults to every Chromium scenario, headed, unthrottled", () => {
    expect(parseFrameBenchArgs([])).toEqual({
      source: "chromium",
      scenarios: ids,
      repeat: null,
      cpuThrottling: 1,
      engine: "webkit",
      headless: false,
      reuseBuild: false,
      out: ".bench/frames-chromium.json",
      raw: false,
      list: false,
    });
  });

  it("runs one scenario or one source by name", () => {
    expect(parseFrameBenchArgs(["--scenario", "typing"]).scenarios).toEqual(["typing"]);
    expect(
      parseFrameBenchArgs(["--scenario=typing,palette", "--scenario", "scroll"]).scenarios
    ).toEqual(["typing", "scroll", "palette"]);
    const probe = parseFrameBenchArgs(["--source", "probe", "--headless", "--repeat", "5"]);
    expect(probe).toMatchObject({ source: "probe", headless: true, repeat: 5 });
    expect(probe.out).toBe(".bench/frames-probe.json");
    expect(parseFrameBenchArgs(["--", "--cpu-throttle", "4"]).cpuThrottling).toBe(4);
  });

  it("refuses unknown options, sources, scenarios, and bad numbers with the usage", () => {
    for (const argv of [
      ["--fast"],
      ["--source", "firefox"],
      ["--scenario", "nope"],
      ["--repeat", "0"],
      ["--repeat", "1.5"],
      ["--cpu-throttle"],
      ["--source", "chromium", "--engine", "webkit"],
      ["--source", "probe", "--cpu-throttle", "4"],
      ["--source", "android", "--headless"],
    ]) {
      expect(() => parseFrameBenchArgs(argv), argv.join(" ")).toThrow(FrameBenchUsageError);
    }
    expect(() => parseFrameBenchArgs(["--fast"])).toThrow(FRAME_BENCH_USAGE.split("\n")[0]);
  });

  it("refuses a scenario the source does not run, with the reason", () => {
    expect(() =>
      parseFrameBenchArgs(["--source", "android", "--scenario", "sidebar-resize"])
    ).toThrow(/not measured on android: sidebar-resize: phones have no resizable sidebar/);
  });
});
