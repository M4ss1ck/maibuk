import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteReferenceSource } from "@/features/canvas/noteReferenceSource";
import {
  canvasReferencePluginName,
  getCanvasReferenceSource,
  getCanvasReferenceSources,
  useCanvasReferenceResolution,
  useCanvasReferenceResolutions,
  useResolveCanvasReferences,
} from "@/features/canvas/references";
import type { CanvasNode } from "@/features/canvas/types";
import {
  type PluginCanvasReferenceSourceDef,
  type RegisteredContributions,
  deleteRegisteredContributions,
  notifyContributionsChange,
  resetPluginContributionsForTests,
  setRegisteredContributions,
} from "@/features/plugins/contributions-registry";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import type { InstalledPlugin, PluginLifecycle } from "@/features/plugins/types";
import { type PluginContributionId } from "@/features/plugins/types";

/**
 * Plugin-declared Canvas Reference sources join the host ones in the registry
 * (#836): one source per contribution, resolved through the Plugin's broker,
 * and never live until the Plugin registers.
 */

function referenceNode(id: string, source: string, targetId: string): CanvasNode {
  return { id, kind: "reference", source, targetId, position: { x: 0, y: 0 } };
}

function referenceDef(
  pluginId: string,
  displayName: string,
  localId: string
): PluginCanvasReferenceSourceDef {
  return {
    pluginId,
    displayName,
    localId,
    id: `plugin.${pluginId}.${localId}` as PluginContributionId,
    label: `${displayName} ${localId}`,
    icon: "layers",
  };
}

function registerPlugin(defs: PluginCanvasReferenceSourceDef[]): void {
  const { pluginId, displayName } = defs[0];
  const record: RegisteredContributions = {
    pluginId,
    displayName,
    commands: [],
    pages: [],
    sidebarEntries: [],
    itemMenuEntries: [],
    canvasReferenceSources: defs,
    token: Symbol(pluginId),
  };
  setRegisteredContributions(pluginId, record);
  notifyContributionsChange();
}

function unregisterPlugin(pluginId: string): void {
  deleteRegisteredContributions(pluginId);
  notifyContributionsChange();
}

const installedPlugin = (pluginId: string, name: string): InstalledPlugin =>
  ({ pluginId, manifest: { id: pluginId, name } }) as unknown as InstalledPlugin;

let brokerRequest: ReturnType<typeof vi.fn>;
let lifecycle: PluginLifecycle;

function installLifecycle(): void {
  brokerRequest = vi.fn();
  lifecycle = {
    installed: () => [installedPlugin("acme", "Acme Cards")],
    state: () => ({ status: "ready" }),
    start: vi.fn(async () => ({ ok: true })),
    runtime: vi.fn(() => ({ broker: { request: brokerRequest } })),
    dispose: () => {},
  } as unknown as PluginLifecycle;
  setPluginLifecycleInstance(lifecycle);
}

function renderReference(nodes: CanvasNode[]) {
  return renderHook(
    ({ current }: { current: CanvasNode[] }) => {
      useResolveCanvasReferences(current);
      return useCanvasReferenceResolution("plugin.acme.cards", "card-1");
    },
    { initialProps: { current: nodes } }
  );
}

beforeEach(() => {
  useCanvasReferenceResolutions.getState().clear();
  installLifecycle();
});

afterEach(() => {
  vi.restoreAllMocks();
  useCanvasReferenceResolutions.getState().clear();
  resetPluginContributionsForTests();
  resetPluginLifecycleForTests();
});

describe("the merged Canvas Reference registry", () => {
  it("lists the host sources, then the Plugin sources ordered by Plugin name", () => {
    registerPlugin([referenceDef("zeta", "Zeta", "two")]);
    registerPlugin([referenceDef("acme", "Acme", "one")]);

    expect(getCanvasReferenceSources().map((source) => source.id)).toEqual([
      "note",
      "book",
      "chapter",
      "canvas",
      "plugin.acme.one",
      "plugin.zeta.two",
    ]);
  });

  it("shapes a Plugin source from its contribution", () => {
    registerPlugin([referenceDef("acme", "Acme", "one")]);

    const source = getCanvasReferenceSource("plugin.acme.one");

    expect(source).toMatchObject({
      id: "plugin.acme.one",
      label: "Acme one",
      card: "generic",
      plugin: { pluginId: "acme", name: "Acme" },
    });
    expect(source?.subscribe).toBeUndefined();
  });

  it("keeps one snapshot until the contributions change", () => {
    const before = getCanvasReferenceSources();
    expect(getCanvasReferenceSources()).toBe(before);

    registerPlugin([referenceDef("acme", "Acme", "one")]);

    const after = getCanvasReferenceSources();
    expect(after).not.toBe(before);
    expect(after.at(-1)?.id).toBe("plugin.acme.one");
    expect(getCanvasReferenceSources()).toBe(after);
  });

  it("removes a Plugin source when its contributions unregister", () => {
    registerPlugin([referenceDef("acme", "Acme", "one")]);
    expect(getCanvasReferenceSource("plugin.acme.one")).toBeDefined();

    unregisterPlugin("acme");

    expect(getCanvasReferenceSource("plugin.acme.one")).toBeUndefined();
    expect(getCanvasReferenceSources().map((source) => source.id)).toEqual([
      "note",
      "book",
      "chapter",
      "canvas",
    ]);
  });
});

describe("useResolveCanvasReferences() with Plugin sources", () => {
  it("never touches the lifecycle for host references or an empty Canvas", async () => {
    const resolveNote = vi.spyOn(noteReferenceSource, "resolve").mockResolvedValue({});

    const { rerender } = renderHook(
      ({ current }: { current: CanvasNode[] }) => {
        useResolveCanvasReferences(current);
      },
      { initialProps: { current: [referenceNode("node-1", "note", "note-a")] } }
    );

    await waitFor(() => expect(resolveNote).toHaveBeenCalled());

    rerender({ current: [] });
    await act(async () => {});

    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(lifecycle.runtime).not.toHaveBeenCalled();
  });

  it("asks nothing until the Plugin registers, then sends one resolve and merges the answer", async () => {
    brokerRequest.mockResolvedValue({
      "card-1": { status: "present", title: "Card one" },
    });
    const nodes = [referenceNode("node-1", "plugin.acme.cards", "card-1")];
    const { result } = renderReference(nodes);

    await act(async () => {});
    expect(getCanvasReferenceSource("plugin.acme.cards")).toBeUndefined();
    expect(brokerRequest).not.toHaveBeenCalled();
    expect(lifecycle.start).not.toHaveBeenCalled();
    expect(lifecycle.runtime).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();

    act(() => {
      registerPlugin([referenceDef("acme", "Acme", "cards")]);
    });

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({ status: "present", title: "Card one" })
      )
    );
    expect(brokerRequest).toHaveBeenCalledTimes(1);
    expect(brokerRequest).toHaveBeenCalledWith("canvasReference.resolve", {
      source: "cards",
      ids: ["card-1"],
    });
  });

  it("keeps working after the Plugin unregisters and registers again", async () => {
    brokerRequest.mockResolvedValue({
      "card-1": { status: "present", title: "Card one" },
    });
    registerPlugin([referenceDef("acme", "Acme", "cards")]);
    const { result, rerender } = renderReference([
      referenceNode("node-1", "plugin.acme.cards", "card-1"),
    ]);

    await waitFor(() =>
      expect(result.current).toEqual(
        expect.objectContaining({ status: "present", title: "Card one" })
      )
    );
    expect(brokerRequest).toHaveBeenCalledTimes(1);

    act(() => {
      unregisterPlugin("acme");
    });
    expect(getCanvasReferenceSource("plugin.acme.cards")).toBeUndefined();

    act(() => {
      registerPlugin([referenceDef("acme", "Acme", "cards")]);
    });

    brokerRequest.mockResolvedValue({
      "card-2": { status: "present", title: "Card two" },
    });
    rerender({
      current: [referenceNode("node-1", "plugin.acme.cards", "card-2")],
    });

    await waitFor(() => expect(brokerRequest).toHaveBeenCalledTimes(2));
    expect(brokerRequest).toHaveBeenLastCalledWith("canvasReference.resolve", {
      source: "cards",
      ids: ["card-2"],
    });
  });

  it("never mutates the nodes it is given", async () => {
    brokerRequest.mockResolvedValue({
      "card-1": { status: "present", title: "Card one" },
    });
    registerPlugin([referenceDef("acme", "Acme", "cards")]);
    const nodes = [referenceNode("node-1", "plugin.acme.cards", "card-1")];
    const untouched = structuredClone(nodes);

    const { result } = renderReference(nodes);

    await waitFor(() =>
      expect(result.current).toEqual(expect.objectContaining({ status: "present" }))
    );
    expect(nodes).toEqual(untouched);
  });

  it("leaves the reference unresolved and warns once when the Plugin rejects", async () => {
    const error = new Error("worker gone");
    brokerRequest.mockRejectedValue(error);
    registerPlugin([referenceDef("acme", "Acme", "cards")]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result } = renderReference([referenceNode("node-1", "plugin.acme.cards", "card-1")]);

    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith("[canvas] reference resolve failed", {
      source: "plugin.acme.cards",
      error,
    });
    expect(useCanvasReferenceResolutions.getState().resolutions).toEqual({});
    expect(result.current).toBeUndefined();
  });
});

describe("canvasReferencePluginName()", () => {
  it("returns the installed Plugin's name for a Plugin source id", () => {
    expect(canvasReferencePluginName("plugin.acme.cards")).toBe("Acme Cards");
  });

  it("returns undefined for an unknown Plugin id and for a host source", () => {
    expect(canvasReferencePluginName("plugin.unknown.cards")).toBeUndefined();
    expect(canvasReferencePluginName("note")).toBeUndefined();
  });
});
