import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pluginCommandBindings,
  pluginPageCommandBindings,
  pluginPageCommands,
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
import type { PluginCommandId } from "@/lib/shortcut-registry";
import {
  EMPTY_PLUGIN_ITEM_CONTEXT,
  type PluginItemContext,
} from "@/features/plugins/target-context";
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
        // A page-scoped Command: its Context is the page's local id, and its
        // keys are live only on that page.
        { id: "digest", label: "Digest", contexts: ["report"], defaults: [["Mod+Alt+j"]] },
        { id: "tag", label: "Tag chapter", contexts: ["chapterItem"], targets: ["chapter"] },
        // A target Command that declares a screen Context: the four-ways fixture.
        { id: "stamp", label: "Stamp", contexts: ["global", "chapterItem"], targets: ["chapter"] },
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

describe("pluginPageCommands", () => {
  it("lists the Commands whose Context is the page's derived Context", () => {
    expect(pluginPageCommands("sample", "report")).toEqual([
      { localId: "digest", id: "plugin.sample.digest" as PluginCommandId },
    ]);
    expect(pluginPageCommands("sample", "elsewhere")).toEqual([]);
  });
});

describe("pluginPageCommandBindings", () => {
  it("binds a page Command disabled before ready and bound once ready", () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;

    const stopped = pluginPageCommandBindings(
      stubLifecycle({ status: "stopped", reason: null, refusal: null }, null),
      "sample",
      "report"
    );
    expect(stopped.map((binding) => binding.id)).toEqual(["plugin.sample.digest"]);
    expect(stopped[0]?.enabled).toBe(false);

    const ready = pluginPageCommandBindings(
      stubLifecycle({ status: "ready", startReason: "launch" }, runtime),
      "sample",
      "report"
    );
    expect(ready[0]?.enabled).toBe(true);
    ready[0]?.onTrigger();
    expect(request).toHaveBeenCalledWith("command.run", { id: "digest" });
  });
});

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

  it("enables a targeted Command when a Chapter is open and runs it with that target", () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);
    const context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "A" };

    const bindings = pluginCommandBindings(lifecycle, vi.fn(), () => context);
    const stamp = bindings.find((binding) => binding.id === "plugin.sample.stamp");
    expect(stamp?.enabled).toBe(true);
    stamp?.onTrigger();
    expect(request).toHaveBeenCalledWith("command.run", {
      id: "stamp",
      target: { kind: "chapter", id: "A" },
    });
  });

  it("keeps a targeted Command disabled, and never runs it, with no context", () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);

    const bindings = pluginCommandBindings(lifecycle, vi.fn(), () => EMPTY_PLUGIN_ITEM_CONTEXT);
    const stamp = bindings.find((binding) => binding.id === "plugin.sample.stamp");
    expect(stamp?.enabled).toBe(false);
    stamp?.onTrigger?.();
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps an item-menu-only Command item-scoped (its focused row binds it)", () => {
    const runtime = {
      broker: { request: vi.fn(async () => null) },
      stop: vi.fn(),
    } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);
    const context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "A" };

    const tag = pluginCommandBindings(lifecycle, vi.fn(), () => context).find(
      (binding) => binding.id === "plugin.sample.tag"
    );
    expect(tag?.enabled).toBe(false);
  });

  it("captures the target at trigger time and never redirects it when the context changes", async () => {
    let release: () => void = () => {};
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);
    let context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "A" };

    const stamp = pluginCommandBindings(lifecycle, vi.fn(), () => context).find(
      (binding) => binding.id === "plugin.sample.stamp"
    );
    stamp?.onTrigger();
    // Focus (and the resolver's context) moves to another Chapter while the
    // request is in flight.
    context = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "B" };
    release();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith("command.run", {
      id: "stamp",
      target: { kind: "chapter", id: "A" },
    });
  });

  it("does not run when the target vanished before the trigger", () => {
    const request = vi.fn(async () => null);
    const runtime = { broker: { request }, stop: vi.fn() } as unknown as PluginRuntime;
    const lifecycle = stubLifecycle({ status: "ready", startReason: "launch" }, runtime);
    let context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "A" };

    const stamp = pluginCommandBindings(lifecycle, vi.fn(), () => context).find(
      (binding) => binding.id === "plugin.sample.stamp"
    );
    // The Chapter is deleted before the Command fires: the resolver (reading
    // the store live) finds nothing, so nothing is sent.
    context = EMPTY_PLUGIN_ITEM_CONTEXT;
    stamp?.onTrigger();

    expect(request).not.toHaveBeenCalled();
  });

  it("does not run a targeted Command while the Plugin is not ready, even with a context", () => {
    const request = vi.fn(async () => null);
    const lifecycle = stubLifecycle({ status: "stopped", reason: null, refusal: null }, null);
    const context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "A" };

    const bindings = pluginCommandBindings(lifecycle, vi.fn(), () => context);
    const stamp = bindings.find((binding) => binding.id === "plugin.sample.stamp");
    expect(stamp?.enabled).toBe(false);
    stamp?.onTrigger();
    expect(request).not.toHaveBeenCalled();
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

  it("reports cancelled when the target changed while the request was pending", async () => {
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
    // The editor or selection changed before the broker answered: the result
    // must never be applied to the new target.
    current = { kind: "chapter", id: "B" };
    release();
    await expect(pending).resolves.toBe("cancelled");
    // The Plugin still received the captured target, never the replacement.
    expect(request).toHaveBeenCalledWith("command.run", {
      id: "tag",
      target: { kind: "chapter", id: "A" },
    });
  });
});
