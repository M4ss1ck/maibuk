import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginReferenceSource } from "@/features/canvas/pluginReferenceSource";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import type { PluginCanvasReferenceSourceDef } from "@/features/plugins/contributions-registry";
import { openPluginPage, setPluginNavigator } from "@/features/plugins/navigation";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginContributionId } from "@/features/plugins/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

/**
 * Opening a Plugin Canvas Reference lands on the Plugin's own page (#786), and
 * that page carries the Canvas it was opened from as its return target.
 */

const { mockOpenPluginCanvasReference } = vi.hoisted(() => ({
  mockOpenPluginCanvasReference: vi.fn(),
}));

vi.mock("@/features/plugins/canvas-reference-requests", () => ({
  listPluginCanvasReferences: vi.fn(),
  resolvePluginCanvasReferences: vi.fn(),
  openPluginCanvasReference: mockOpenPluginCanvasReference,
}));

const PLUGIN_ID = "tracer";
const PAGE_ID = "map";

function referenceDef(): PluginCanvasReferenceSourceDef {
  return {
    pluginId: PLUGIN_ID,
    displayName: "Tracer",
    localId: "items",
    id: `plugin.${PLUGIN_ID}.items` as PluginContributionId,
    label: "Items",
    icon: "layers",
  };
}

/** Registers one installed Plugin that declares the page the open lands on. */
function installPagePlugin(): void {
  const folder = pluginFolder(
    {},
    {
      id: PLUGIN_ID,
      name: "Tracer",
      platforms: ["desktop"],
      contributes: {
        commands: [{ id: "open", label: "Open", contexts: ["global"], navigates: true }],
        pages: [{ id: PAGE_ID, title: "Map", command: "open" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok)
    throw new Error(`fixture manifest is invalid: ${JSON.stringify(parsed.problems)}`);
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

/** The Plugin's own open request opens its page, as a real Plugin's does. */
function pluginOpensItsPage(def: PluginCanvasReferenceSourceDef): void {
  mockOpenPluginCanvasReference.mockImplementation(async () => {
    await openPluginPage(def.pluginId, PAGE_ID, def.pluginId);
    return "opened";
  });
}

const cleanups: Array<() => void> = [];

beforeEach(() => {
  mockOpenPluginCanvasReference.mockReset();
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
});

describe("a Plugin Canvas Reference source opening", () => {
  it("opens the Plugin page with the Canvas as its return target", async () => {
    installPagePlugin();
    const def = referenceDef();
    pluginOpensItsPage(def);
    const navigate = vi.fn();
    const unregister = setPluginNavigator(navigate);
    try {
      await expect(
        pluginReferenceSource(def).open("item-1", {
          canvasId: "c1",
          canvasTitle: "Plot",
          navigate: vi.fn(),
        })
      ).resolves.toBe("opened");
      expect(navigate).toHaveBeenCalledWith(`/plugin/${PLUGIN_ID}/${PAGE_ID}`, {
        state: { returnTo: "/canvas/c1", returnLabel: "Plot" },
      });
    } finally {
      unregister();
    }
  });

  it("carries no return target once the open settles", async () => {
    installPagePlugin();
    const def = referenceDef();
    pluginOpensItsPage(def);
    const navigate = vi.fn();
    const unregister = setPluginNavigator(navigate);
    try {
      await pluginReferenceSource(def).open("item-1", {
        canvasId: "c1",
        canvasTitle: "Plot",
        navigate: vi.fn(),
      });
      navigate.mockClear();

      await openPluginPage(def.pluginId, PAGE_ID, def.pluginId);

      expect(navigate).toHaveBeenCalledWith(`/plugin/${PLUGIN_ID}/${PAGE_ID}`);
    } finally {
      unregister();
    }
  });
});
