import { describe, expect, it } from "vitest";

import {
  type WebkitScenario,
  benchScenarios,
  createCapture,
  echoTextFor,
  launchPlan,
  measurementFile,
  pluginFoldersFor,
} from "../../../../../e2e/plugins-bench/webkitgtk-plan";

describe("benchScenarios", () => {
  it("runs the three launch configs, the on-demand fixture, and the three interactions, in order", () => {
    const scenarios = benchScenarios([]);
    expect(scenarios.map((scenario) => scenario.kind)).toEqual([
      "launch",
      "launch",
      "launch",
      "startToReady",
      "commandToEffect",
      "remoteUiEcho",
      "remoteUiBurst",
    ]);
    expect(scenarios.slice(0, 3)).toEqual([
      { kind: "launch", config: "baseline" },
      { kind: "launch", config: "installed20" },
      { kind: "launch", config: "persistent3" },
    ]);
    expect(scenarios[3]).toEqual({ kind: "startToReady", id: "fixture-everything-on-demand" });
  });

  it("adds startToReady entries for every on-demand Built-in id, without duplicating the fixture", () => {
    const scenarios = benchScenarios(["maibuk.notes", "fixture-everything-on-demand"]);
    const ids = scenarios
      .filter((scenario) => scenario.kind === "startToReady")
      .map((scenario) => (scenario as { id: string }).id);
    expect(ids).toEqual(["fixture-everything-on-demand", "maibuk.notes"]);
  });
});

describe("launchPlan", () => {
  it("adds two warm-ups to every launch config", () => {
    for (const config of ["baseline", "installed20", "persistent3"] as const) {
      expect(launchPlan({ kind: "launch", config }, 10)).toEqual({ launches: 12, warmups: 2 });
    }
  });

  it("needs one fresh launch per startToReady sample and one launch for the interactions", () => {
    expect(launchPlan({ kind: "startToReady", id: "fixture-bench" }, 10)).toEqual({
      launches: 10,
      warmups: 0,
    });
    expect(launchPlan({ kind: "commandToEffect" }, 10)).toEqual({ launches: 1, warmups: 0 });
    expect(launchPlan({ kind: "remoteUiEcho" }, 10)).toEqual({ launches: 1, warmups: 0 });
    expect(launchPlan({ kind: "remoteUiBurst" }, 10)).toEqual({ launches: 1, warmups: 0 });
  });
});

describe("measurementFile", () => {
  it("keys each scenario like the Chromium lane", () => {
    const cases: Array<[WebkitScenario, string]> = [
      [{ kind: "launch", config: "baseline" }, "launch-baseline"],
      [{ kind: "launch", config: "installed20" }, "launch-installed20"],
      [{ kind: "launch", config: "persistent3" }, "launch-persistent3"],
      [{ kind: "startToReady", id: "x" }, "startToReady"],
      [{ kind: "commandToEffect" }, "commandToEffect"],
      [{ kind: "remoteUiEcho" }, "remoteUiEcho"],
      [{ kind: "remoteUiBurst" }, "remoteUiBurst"],
    ];
    for (const [scenario, name] of cases) expect(measurementFile(scenario), name).toBe(name);
  });
});

describe("pluginFoldersFor", () => {
  it("seeds no Plugin for a bare launch", () => {
    expect(pluginFoldersFor({ kind: "launch", config: "baseline" })).toEqual([]);
  });

  it("seeds twenty on-demand clones and three persistent clones", () => {
    expect(pluginFoldersFor({ kind: "launch", config: "installed20" })).toEqual([
      { from: "fixture-everything-on-demand", clones: 20, granted: [] },
    ]);
    expect(pluginFoldersFor({ kind: "launch", config: "persistent3" })).toEqual([
      { from: "fixture-everything", clones: 3, granted: [] },
    ]);
  });

  it("grants each Plugin exactly the Plugin Permissions it declares as required", () => {
    const [command] = pluginFoldersFor({ kind: "commandToEffect" });
    expect(command.from).toBe("fixture-everything");
    expect(command.clones).toBe(0);
    expect(command.granted).toEqual([
      "library:read",
      "library:write",
      "editor:read",
      "editor:decorate",
      "secrets",
      "network:fixture.invalid",
    ]);

    const [echo] = pluginFoldersFor({ kind: "remoteUiEcho" });
    expect(echo.from).toBe("fixture-bench");
    expect(echo.granted).toEqual(["editor:read", "editor:decorate"]);
  });

  it("seeds the startToReady fixture itself, with no grants", () => {
    expect(pluginFoldersFor({ kind: "startToReady", id: "fixture-bench" })).toEqual([
      { from: "fixture-bench", clones: 0, granted: [] },
    ]);
  });
});

describe("echoTextFor", () => {
  it("produces one character per sample, cycling a..z", () => {
    expect(echoTextFor(3)).toBe("abc");
    expect(echoTextFor(10)).toBe("abcdefghij");
    expect(echoTextFor(28)).toHaveLength(28);
    expect(echoTextFor(28).at(-1)).toBe("b");
  });
});

describe("createCapture", () => {
  it("folds one launch's posted samples and reports its /done", () => {
    const capture = createCapture();
    expect(capture.done()).toBe(false);
    capture.measure([10, 11]);
    capture.measure([12]);
    capture.markDone();
    expect(capture.done()).toBe(true);
    expect(capture.samples()).toEqual([10, 11, 12]);
  });

  it("forgets the previous launch on reset", () => {
    const capture = createCapture();
    capture.measure([1]);
    capture.markDone();
    capture.reset();
    expect(capture.done()).toBe(false);
    expect(capture.samples()).toEqual([]);
  });

  it("keeps a lost echo/burst text flag and clears it on reset", () => {
    const capture = createCapture();
    expect(capture.textLost()).toBe(false);
    capture.measure([1, 2], true);
    expect(capture.textLost()).toBe(true);
    // A later measure without the flag never un-loses the launch.
    capture.measure([3]);
    expect(capture.textLost()).toBe(true);
    capture.reset();
    expect(capture.textLost()).toBe(false);
  });
});
