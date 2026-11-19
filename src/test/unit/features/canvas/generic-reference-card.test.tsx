/**
 * The Generic Canvas Reference card (#836): what a Plugin-declared source draws
 * once it answered, the source header every state of it keeps, the one box it
 * holds in every state, and the line an Unavailable one shows when its Plugin
 * is installed here.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { PluginCanvasReferenceSourceDef } from "@/features/plugins/contributions-registry";
import type { InlineIcon } from "@/features/plugins/inline-icon";
import type {
  InstalledPlugin,
  PluginContributionId,
  PluginLifecycle,
} from "@/features/plugins/types";
import { installPointerEvent } from "@/test/support/pointer-events";

installPointerEvent();

const SOURCE_ID = "plugin.acme.cards";
const SOURCE_LABEL = "Cards";

const mocks = vi.hoisted(() => ({
  selectNode: vi.fn(),
  removeNode: vi.fn(),
  openConnectPicker: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  Handle: ({ className }: { className?: string }) => (
    <span data-testid="handle" className={className} />
  ),
  Position: { Top: "top", Right: "right", Bottom: "bottom", Left: "left" },
  NodeResizeControl: () => null,
  ResizeControlVariant: { Line: "line", Handle: "handle" },
}));

vi.mock("@/features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectNode: mocks.selectNode,
      removeNode: mocks.removeNode,
      openConnectPicker: mocks.openConnectPicker,
      editorReadOnly: false,
      interactivityLocked: false,
    }),
}));

vi.mock("@/features/books/store", () => ({
  useBookStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ books: [] }),
}));

const { ReferenceNode } = await import("@/features/canvas/nodes/ReferenceNode");
const { CANVAS_REFERENCE_CARD_SIZES, useCanvasReferenceResolutions } = await import(
  "@/features/canvas/references"
);
const {
  deleteRegisteredContributions,
  notifyContributionsChange,
  resetPluginContributionsForTests,
  setRegisteredContributions,
} = await import("@/features/plugins/contributions-registry");
const { resetPluginLifecycleForTests, setPluginLifecycleInstance } = await import(
  "@/features/plugins/lifecycle-instance"
);

const cardsIcon: InlineIcon = { elements: [["path", { d: "M4 4h16v16H4z" }]] };

const fixtureDef: PluginCanvasReferenceSourceDef = {
  pluginId: "acme",
  displayName: "Fixture",
  localId: "cards",
  id: SOURCE_ID as PluginContributionId,
  label: SOURCE_LABEL,
  icon: cardsIcon,
};

function registerFixturePlugin(): void {
  setRegisteredContributions("acme", {
    pluginId: "acme",
    displayName: "Fixture",
    commands: [],
    pages: [],
    sidebarEntries: [],
    itemMenuEntries: [],
    canvasReferenceSources: [fixtureDef],
    token: Symbol("acme"),
  });
  notifyContributionsChange();
}

function unregisterFixturePlugin(): void {
  deleteRegisteredContributions("acme");
  notifyContributionsChange();
}

let brokerRequest: ReturnType<typeof vi.fn>;

const installedPlugin = (pluginId: string, name: string): InstalledPlugin =>
  ({ pluginId, manifest: { id: pluginId, name } }) as unknown as InstalledPlugin;

function installLifecycle(
  installed: InstalledPlugin[] = [installedPlugin("acme", "Fixture")]
): void {
  brokerRequest = vi.fn();
  setPluginLifecycleInstance({
    installed: () => installed,
    state: () => ({ status: "ready" }),
    start: vi.fn(async () => ({ ok: true })),
    runtime: () => ({ broker: { request: brokerRequest } }),
    subscribe: () => () => {},
    launchScanned: () => true,
    onLaunchScanned: () => () => {},
    surfaceReached: () => {},
    surfaceLeft: () => {},
    dispose: () => {},
  } as unknown as PluginLifecycle);
}

function referenceData(node: Record<string, unknown> = {}) {
  return {
    node: {
      id: "ref",
      kind: "reference",
      source: SOURCE_ID,
      targetId: "card-1",
      position: { x: 0, y: 0 },
      ...node,
    },
    canvasId: "canvas",
    canvasTitle: "Map",
    connectedSides: {},
  };
}

function renderReference(node: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ReferenceNode
        {...({ selected: false, data: referenceData(node) } as Parameters<typeof ReferenceNode>[0])}
      />
    </MemoryRouter>
  );
}

function answer(
  targetId: string,
  resolution: { status: "present"; title: string; value: unknown } | { status: "missing" }
): void {
  useCanvasReferenceResolutions.getState().mergeAnswers(SOURCE_ID, { [targetId]: resolution });
}

const openButton = () => screen.getByRole("button", { name: /^Open/ });

describe("the Generic Canvas Reference card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCanvasReferenceResolutions.getState().clear();
    registerFixturePlugin();
    installLifecycle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useCanvasReferenceResolutions.getState().clear();
    resetPluginContributionsForTests();
    resetPluginLifecycleForTests();
  });

  it("draws the source's icon and name, the title, and the subtitle for a Present reference", () => {
    answer("card-1", { status: "present", title: "Harbour map", value: { subtitle: "Porto" } });

    renderReference();

    const name = screen.getByText(SOURCE_LABEL);
    expect(name).toHaveClass("truncate");
    expect(name.parentElement?.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(screen.getByText("Harbour map")).toHaveClass("line-clamp-2");
    expect(screen.getByText("Porto")).toHaveClass("line-clamp-1");
  });

  it("shows a title that carries markup as that literal text", () => {
    answer("card-1", { status: "present", title: "<b>bold</b>", value: {} });

    const { container } = renderReference();

    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
  });

  it("keeps the generic box and the source header in every state, with the stored label", () => {
    const states: Array<{ name: string; seed?: () => void; registered?: boolean }> = [
      {
        name: "present",
        seed: () => answer("card-1", { status: "present", title: "Harbour map", value: {} }),
      },
      { name: "missing", seed: () => answer("card-1", { status: "missing" }) },
      { name: "unresolved" },
      { name: "unavailable", registered: false },
    ];

    const boxes: Array<{ name: string; width: string; height: string }> = [];
    for (const state of states) {
      useCanvasReferenceResolutions.getState().clear();
      if (state.registered === false) unregisterFixturePlugin();
      else registerFixturePlugin();
      state.seed?.();
      const { container, unmount } = renderReference({ label: "Stored card" });
      const card = container.firstElementChild as HTMLElement;
      boxes.push({ name: state.name, width: card.style.width, height: card.style.height });

      if (state.registered === false) {
        expect(screen.queryByText(SOURCE_LABEL)).toBeNull();
        expect(screen.getByText("Stored card")).toBeInTheDocument();
      } else {
        expect(screen.getByText(SOURCE_LABEL)).toBeInTheDocument();
        if (state.name !== "present") expect(screen.getByText("Stored card")).toBeInTheDocument();
      }
      unmount();
    }

    expect(boxes.map((box) => box.name)).toEqual([
      "present",
      "missing",
      "unresolved",
      "unavailable",
    ]);
    for (const box of boxes) {
      expect({ width: box.width, height: box.height }).toEqual({
        width: `${CANVAS_REFERENCE_CARD_SIZES.generic.width}px`,
        height: `${CANVAS_REFERENCE_CARD_SIZES.generic.height}px`,
      });
    }
  });

  it("names a Plugin that registered this session in an Unavailable card", () => {
    unregisterFixturePlugin();

    renderReference({ label: "Stored card" });

    expect(screen.getByText("Needs the Fixture Plugin")).toBeInTheDocument();
    expect(screen.queryByText("Not available here")).toBeNull();
  });

  it("falls back to the plain unavailable line for a Plugin this session never saw", () => {
    resetPluginContributionsForTests();

    renderReference({ label: "Stored card" });

    expect(screen.getByText("Not available here")).toBeInTheDocument();
  });

  it("reaches Open with Tab and opens the Plugin's target with Enter", async () => {
    const user = userEvent.setup();
    brokerRequest.mockResolvedValue("opened");
    answer("card-1", { status: "present", title: "Harbour map", value: {} });

    renderReference();
    await user.tab();

    expect(document.activeElement).toBe(openButton());

    await user.keyboard("{Enter}");

    expect(brokerRequest).toHaveBeenCalledWith("canvasReference.open", {
      source: "cards",
      id: "card-1",
    });
  });

  it("keeps Open disabled in a Missing card and an Unavailable one", () => {
    answer("card-1", { status: "missing" });
    const missing = renderReference();
    expect(openButton()).toBeDisabled();
    missing.unmount();

    unregisterFixturePlugin();
    renderReference();
    expect(openButton()).toBeDisabled();
  });
});
