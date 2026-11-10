import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installArrowNavigation } from "@/lib/arrow-navigation";
import { PluginPage } from "@/pages/PluginPage";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

// Mod resolves to Ctrl off-mac.
vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

// The host renderer is only there for the keyboard test: two plain buttons in
// the page body, laid out one below the other.
vi.mock("@/features/plugins/remote-ui", () => ({
  PluginRemoteUiBoundary: () => (
    <>
      <button type="button" data-rect="0 0 100 40">
        Plain
      </button>
      <button type="button" data-rect="0 60 100 100">
        Below
      </button>
    </>
  ),
}));

const brokerRequest = vi.fn(async () => null);

vi.mock("@/hooks/usePluginSurface", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePluginSurface")>();
  return {
    ...mod,
    useInstalledPluginLifecycle: () => stubLifecycle,
    usePluginLifecycleRevision: () => 0,
    usePluginSurface: () => undefined,
  };
});

const stubLifecycle = {
  state: (pluginId: string) =>
    pluginId === "sample" ? { status: "ready", startReason: "launch" } : null,
  runtime: (pluginId: string) =>
    pluginId === "sample"
      ? ({ broker: { request: brokerRequest }, stop: vi.fn() } as unknown as PluginRuntime)
      : null,
  launchScanned: () => true,
  onLaunchScanned: () => () => undefined,
} as unknown as PluginLifecycle;

const cleanups: Array<() => void> = [];

/** jsdom has no layout: each element reads its rect from `data-rect`. */
const realRect = Element.prototype.getBoundingClientRect;
function stubRects(): void {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const [left, top, right, bottom] = (this.getAttribute("data-rect") ?? "0 0 0 0")
      .split(" ")
      .map(Number);
    return {
      x: left,
      y: top,
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
      toJSON() {},
    } as DOMRect;
  };
}

/** A page whose own Command takes the bare ArrowDown only when `liftsArrow`. */
function registerSample(liftsArrow: boolean): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          {
            id: "digest",
            label: "Digest",
            contexts: ["report"],
            defaults: liftsArrow ? [["ArrowDown"]] : [["Mod+Alt+j"]],
          },
        ],
        pages: [{ id: "report", title: "Sample report", command: "open" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={["/plugin/sample/report"]}>
      <Routes>
        <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
      </Routes>
    </MemoryRouter>
  );
}

let uninstall: (() => void) | null = null;

beforeEach(() => {
  stubRects();
  brokerRequest.mockClear();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  Element.prototype.getBoundingClientRect = realRect;
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
});

describe("PluginPage and the bare Arrows", () => {
  it("owns the arrows on a page whose Command lifts one, so the Command runs and focus stays", async () => {
    registerSample(true);
    uninstall = installArrowNavigation();
    renderPage();
    const user = userEvent.setup();
    const plain = await screen.findByRole("button", { name: "Plain" });
    expect(plain.closest("[data-owns-arrows]")).not.toBeNull();

    act(() => plain.focus());
    await user.keyboard("{ArrowDown}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", { id: "digest" });
    expect(plain).toHaveFocus();
    expect(screen.getByRole("button", { name: "Below" })).not.toHaveFocus();
  });

  it("keeps arrow-navigation on a page whose Commands lift no Arrow", async () => {
    registerSample(false);
    uninstall = installArrowNavigation();
    renderPage();
    const user = userEvent.setup();
    const plain = await screen.findByRole("button", { name: "Plain" });
    expect(plain.closest("[data-owns-arrows]")).toBeNull();

    act(() => plain.focus());
    await user.keyboard("{ArrowDown}");

    expect(brokerRequest).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Below" })).toHaveFocus();
  });
});
