/**
 * The pure half of the Plugins bench's WebKitGTK lane (issue #448, unit 4b).
 *
 * The lane drives the real Tauri Linux binary because its WebKit has no OPFS,
 * so Plugins cannot be seeded the Playwright way. Everything the lane decides
 * before it touches a process — which scenarios there are, how many app
 * launches each needs, which fixture folders seed the Plugin Directory, and
 * which Plugin Permissions their approval records grant — lives here, with no
 * I/O, so the runner's plan is unit-tested without building or launching
 * anything. `webkitgtk.ts` is the process and socket shell around it.
 */

import { MEASUREMENT_FILES } from "./report";

/** One launch-configuration scenario: the same three the Chromium lane runs. */
export type WebkitLaunchConfig = "baseline" | "installed20" | "persistent3";

/** One thing the WebKitGTK lane measures. */
export type WebkitScenario =
  | { kind: "launch"; config: WebkitLaunchConfig }
  | { kind: "startToReady"; id: string }
  | { kind: "commandToEffect" }
  | { kind: "remoteUiEcho" }
  | { kind: "remoteUiBurst" };

/** The on-demand fixture every lane starts with (no shipped Built-in declares one). */
export const ON_DEMAND_FIXTURE = "fixture-everything-on-demand";

/** `fixture-everything`'s required Plugin Permissions, in manifest order. */
export const EVERYTHING_REQUIRED = [
  "library:read",
  "library:write",
  "editor:read",
  "editor:decorate",
  "secrets",
  "network:fixture.invalid",
] as const;

/** `fixture-bench`'s required Plugin Permissions. */
export const BENCH_REQUIRED = ["editor:read", "editor:decorate"] as const;

/** The Plugin Directory folders one scenario seeds. */
export interface PluginFolderPlan {
  /** The fixture folder under `e2e/.output/plugins` the bytes are read from. */
  from: string;
  /** How many clones (0 = one plain copy of `from`). */
  clones: number;
  /** The Plugin Permissions the seeded approval record grants. */
  granted: readonly string[];
}

/** How many app launches one scenario needs, and how many are warm-ups. */
export interface LaunchPlan {
  launches: number;
  warmups: number;
}

/**
 * The app launches one scenario needs. `launch` reloads `samples + 2` times and
 * discards two warm-ups, exactly as the Chromium lane does per config;
 * `startToReady` needs one fresh launch per sample (the measure is created once
 * per start, so a reload is the only way to a fresh one); the rest take every
 * sample inside one launch, like their Chromium tests.
 */
export function launchPlan(scenario: WebkitScenario, samples: number): LaunchPlan {
  switch (scenario.kind) {
    case "launch":
      return { launches: samples + 2, warmups: 2 };
    case "startToReady":
      return { launches: samples, warmups: 0 };
    default:
      return { launches: 1, warmups: 0 };
  }
}

/** The per-measurement JSON file one scenario writes, keyed like the Chromium lane. */
export function measurementFile(scenario: WebkitScenario): string {
  switch (scenario.kind) {
    case "launch":
      return scenario.config === "baseline"
        ? MEASUREMENT_FILES.launchBaseline
        : scenario.config === "installed20"
          ? MEASUREMENT_FILES.launchInstalled20
          : MEASUREMENT_FILES.launchPersistent3;
    case "startToReady":
      return MEASUREMENT_FILES.startToReady;
    case "commandToEffect":
      return MEASUREMENT_FILES.commandToEffect;
    case "remoteUiEcho":
      return MEASUREMENT_FILES.remoteUiEcho;
    case "remoteUiBurst":
      return MEASUREMENT_FILES.remoteUiBurst;
  }
}

/** The Plugin Directory folders one scenario seeds, before any launch. */
export function pluginFoldersFor(scenario: WebkitScenario): PluginFolderPlan[] {
  switch (scenario.kind) {
    case "launch":
      if (scenario.config === "installed20") {
        return [{ from: ON_DEMAND_FIXTURE, clones: 20, granted: [] }];
      }
      if (scenario.config === "persistent3") {
        return [{ from: "fixture-everything", clones: 3, granted: [] }];
      }
      return [];
    case "startToReady":
      return [{ from: scenario.id, clones: 0, granted: [] }];
    case "commandToEffect":
      return [{ from: "fixture-everything", clones: 0, granted: [...EVERYTHING_REQUIRED] }];
    case "remoteUiEcho":
    case "remoteUiBurst":
      return [{ from: "fixture-bench", clones: 0, granted: [...BENCH_REQUIRED] }];
  }
}

/**
 * Every scenario the lane runs, in order: the three launch configs, then
 * startToReady for the on-demand fixture and every on-demand id a shipped
 * Built-in declares (`plugins/builtins.json`, empty today), then the three
 * interaction measurements. Pure, so the run order is unit-tested.
 */
export function benchScenarios(onDemandIds: readonly string[] = []): WebkitScenario[] {
  const ids = [ON_DEMAND_FIXTURE, ...onDemandIds.filter((id) => id !== ON_DEMAND_FIXTURE)];
  return [
    { kind: "launch", config: "baseline" },
    { kind: "launch", config: "installed20" },
    { kind: "launch", config: "persistent3" },
    ...ids.map((id): WebkitScenario => ({ kind: "startToReady", id })),
    { kind: "commandToEffect" },
    { kind: "remoteUiEcho" },
    { kind: "remoteUiBurst" },
  ];
}

/** The characters the echo/burst measurement types: one per sample. */
export function echoTextFor(samples: number): string {
  return Array.from({ length: samples }, (_, index) => String.fromCharCode(97 + (index % 26))).join(
    ""
  );
}
