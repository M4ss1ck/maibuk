import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pluginCommandBindings,
  runPluginCommand,
  type PluginItemTarget,
} from "@/features/plugins/commands";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type {
  PluginLifecycle,
  PluginLifecycleState,
  PluginRuntime,
} from "@/features/plugins/types";
import { registerCommandSource, runCommand } from "@/lib/command-runner";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const source = pluginFolder(
  {},
  {
    id: "sample",
    name: "Sample",
    platforms: ["desktop"],
    contributes: {
      commands: [
        { id: "open", label: "Open report", contexts: ["global"], navigates: true },
        { id: "report", label: "Report", contexts: ["global"] },
        { id: "tag", label: "Tag chapter", contexts: ["chapterItem"], targets: ["chapter"] },
      ],
      pages: [{ id: "report", title: "Report", command: "open" }],
      itemMenuEntries: [{ command: "tag" }],
    },
  }
);
const parsed = readPluginManifest(source);
if (!parsed.ok) throw new Error("fixture manifest is invalid");
const manifest = parsed.manifest;

let unregister: (() => void) | null = null;

beforeEach(() => {
  unregister = registerPluginContributions({ manifest, folder: source });
});

afterEach(() => {
  unregister?.();
  unregister = null;
  resetPluginContributionsForTests();
});

function stubLifecycle(
  state: PluginLifecycleState,
  runtime: PluginRuntime | null
): PluginLifecycle {
  const installed = {
    pluginId: "sample",
    approval: { pluginId: "sample", pinnedHash: "h1:x", granted: [] },
    folder: source,
    manifest,
  };
  return {
    installed: () => [installed],
    state: () => state,
    runtime: () => runtime,
  } as unknown as PluginLifecycle;
}

describe("pluginCommandBindings", () => {
  it("navigates a page's Command and disables an unready Plugin's worker Command", () => {
    const navigate = vi.fn();
    const bindings = pluginCommandBindings(stubLifecycle({ status: "stopped", reason: null, refusal: null }, null), navigate);

    const open = bindings.find((binding) => binding.id === "plugin.sample.open");
    expect(open?.enabled).toBe(true);
    open?.onTrigger();
    expect(navigate).toHaveBeenCalledWith("/plugin/sample/report");

    const report = bindings.find((binding) => binding.id === "plugin.sample.report");
    expect(report?.enabled).toBe(false);
  });

  it("enables a worker Command only once the Plugin is ready, and never a target Command", () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const bindings = pluginCommandBindings(
      stubLifecycle({ status: "ready", startReason: "launch" }, runtime),
      vi.fn()
    );

    const report = bindings.find((binding) => binding.id === "plugin.sample.report");
    expect(report?.enabled).toBe(true);
    report?.onTrigger();
    expect(request).toHaveBeenCalledWith("command.run", { id: "report" });

    // A target Command is never runnable without an Item Menu target to supply.
    const tag = bindings.find((binding) => binding.id === "plugin.sample.tag");
    expect(tag?.enabled).toBe(false);
  });

  it("runs through the shared runner the keyboard, palette, and voice all call", async () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);
    const unregister = registerCommandSource(() => pluginCommandBindings(lifecycle, vi.fn()));
    try {
      expect(await runCommand("plugin.sample.report", { source: "palette" })).toBe("ran");
      expect(request).toHaveBeenCalledWith("command.run", { id: "report" });
    } finally {
      unregister();
    }
  });
});

describe("runPluginCommand", () => {
  it("reports unavailable when the Plugin is not running", async () => {
    const lifecycle = stubLifecycle({ status: "stopped", reason: null, refusal: null }, null);
    expect(await runPluginCommand(lifecycle, "sample", "report")).toBe("unavailable");
  });

  it("cancels rather than guessing when the target is gone", async () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);

    const outcome = await runPluginCommand(lifecycle, "sample", "tag", {
      readTarget: () => null,
    });

    expect(outcome).toBe("cancelled");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends the target captured before the request, never a target that replaced it", async () => {
    let release: () => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);

    let current: PluginItemTarget | null = { kind: "chapter", id: "A" };
    const pending = runPluginCommand(lifecycle, "sample", "tag", { readTarget: () => current });
    // Focus moves to another Chapter while the request is in flight.
    current = { kind: "chapter", id: "B" };
    release();
    await pending;

    expect(request).toHaveBeenCalledWith("command.run", {
      id: "tag",
      target: { kind: "chapter", id: "A" },
    });
  });
});
