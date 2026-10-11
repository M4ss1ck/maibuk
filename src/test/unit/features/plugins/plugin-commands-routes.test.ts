import { afterEach, describe, expect, it } from "vitest";
import { activeRouteContexts } from "@/components/plugins/PluginCommands";
import { pluginCommandBindings } from "@/features/plugins/commands";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle } from "@/features/plugins/types";
import { getCommand } from "@/lib/shortcut-registry";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
});

function registerEditorPlugin(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "edit", label: "Edit thing", contexts: ["editor"] },
          { id: "tag", label: "Tag chapter", contexts: ["chapterItem"], targets: ["chapter"] },
        ],
        itemMenuEntries: [{ command: "tag" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

function stubLifecycle(): PluginLifecycle {
  return {
    installed: () => [
      {
        pluginId: "sample",
        manifest: { id: "sample" },
        folder: { name: "sample", files: [] },
        approval: { pluginId: "sample", pinnedHash: "h", granted: [] },
      },
    ],
    state: () => ({ status: "ready", startReason: "launch" }),
    runtime: () => null,
  } as unknown as PluginLifecycle;
}

function boundIdsFor(pathname: string): string[] {
  const active = activeRouteContexts(pathname);
  return pluginCommandBindings(stubLifecycle(), () => {})
    .filter((binding) => getCommand(binding.id).contexts.some((context) => active.has(context)))
    .map((binding) => binding.id);
}

describe("activeRouteContexts()", () => {
  it("resolves the editor Context on book, note, and canvas routes", () => {
    registerEditorPlugin();
    for (const pathname of ["/book/abc", "/notes/n1", "/canvas/c1"]) {
      expect(activeRouteContexts(pathname).has("editor")).toBe(true);
      expect(boundIdsFor(pathname)).toContain("plugin.sample.edit");
    }
  });

  it("resolves chapterItem only on the book route", () => {
    registerEditorPlugin();
    expect(activeRouteContexts("/book/abc").has("chapterItem")).toBe(true);
    expect(boundIdsFor("/book/abc")).toContain("plugin.sample.tag");
    for (const pathname of ["/notes/n1", "/canvas/c1", "/"]) {
      expect(activeRouteContexts(pathname).has("chapterItem")).toBe(false);
    }
  });
});
