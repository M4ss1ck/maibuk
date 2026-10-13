/**
 * A targeted Plugin Command in the Command Palette (#446): the palette reads
 * the shared Command states, so a Command enabled by the context-target
 * resolver is listed as runnable and runs with the Chapter's target when the
 * author presses Enter. With no context it goes back to the palette's ordinary
 * disabled/unavailable rule.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCommandItems } from "@/features/command-palette/command-items";
import { pluginCommandBindings } from "@/features/plugins/commands";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import {
  EMPTY_PLUGIN_ITEM_CONTEXT,
  type PluginItemContext,
} from "@/features/plugins/target-context";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import { commandStates, registerCommandSource, runCommand } from "@/lib/command-runner";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  request.mockClear();
});

const t = ((key: string) => `label:${key}`) as Parameters<typeof buildCommandItems>[0]["t"];
const commandId = "plugin.sample.tag" as const;
const request = vi.fn(async () => null);

const lifecycle = {
  installed: () => [{ pluginId: "sample" }],
  state: () => ({ status: "ready", startReason: "launch" }),
  runtime: () => ({ broker: { request }, stop: vi.fn() } as unknown as PluginRuntime),
} as unknown as PluginLifecycle;

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "tag", label: "Tag chapter", contexts: ["global", "chapterItem"], targets: ["chapter"] },
        ],
        itemMenuEntries: [{ command: "tag" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error(`fixture manifest is invalid: ${JSON.stringify(parsed.problems)}`);
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

function listPaletteItems() {
  return buildCommandItems({
    snapshot: commandStates(),
    t,
    language: "en",
    customVoice: {},
  });
}

describe("a targeted Plugin Command in the Command Palette", () => {
  it("is listed and runnable, and runs with the Chapter target, when a Chapter is open", async () => {
    registerSample();
    const context: PluginItemContext = { ...EMPTY_PLUGIN_ITEM_CONTEXT, chapter: "c1" };
    cleanups.push(
      registerCommandSource(() => pluginCommandBindings(lifecycle, vi.fn(), () => context))
    );

    const item = listPaletteItems().find((candidate) => candidate.id === commandId);
    expect(item).toMatchObject({
      key: `command:${commandId}`,
      kind: "command",
      label: "Tag chapter",
      state: "runnable",
    });

    expect(await runCommand(commandId, { source: "palette" })).toBe("ran");
    expect(request).toHaveBeenCalledWith("command.run", {
      id: "tag",
      target: { kind: "chapter", id: "c1" },
    });
  });

  it("is disabled and cannot run with no context", async () => {
    registerSample();
    cleanups.push(
      registerCommandSource(() =>
        pluginCommandBindings(lifecycle, vi.fn(), () => EMPTY_PLUGIN_ITEM_CONTEXT)
      )
    );

    const item = listPaletteItems().find((candidate) => candidate.id === commandId);
    expect(item?.state).toBe("disabled");
    expect(await runCommand(commandId, { source: "palette" })).toBe("unavailable");
    expect(request).not.toHaveBeenCalled();
  });
});
