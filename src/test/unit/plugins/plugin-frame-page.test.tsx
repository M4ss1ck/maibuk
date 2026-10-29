// A whole-page Frame (#454 unit 3, D2): a page contribution that declares
// `frame` renders `PluginFrame variant="page"` instead of the Remote UI tree,
// and a page without one keeps the Remote UI path. The manifest → registry
// hand-off of `frame` is proven here too.

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/i18n";
import { PluginPage } from "@/pages/PluginPage";
import {
  getPluginPage,
  notifyContributionsChange,
  resetPluginContributionsForTests,
  setRegisteredContributions,
} from "@/features/plugins/contributions-registry";
import { registerPluginContributions } from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import { pluginFolder } from "@/test/support/plugin-fixtures";
import type { PluginCommandId } from "@/lib/shortcut-registry";
import type { PluginContributionId, PluginRuntime } from "@/features/plugins/types";
import type { PluginManifest } from "@/features/plugins/types";

const { lifecycle } = vi.hoisted(() => {
  const runtime = {
    manifest: { customUi: true } as PluginManifest,
    broker: {} as never,
    files: [],
    sendFrame: () => {},
    stop: () => {},
  };
  return {
    lifecycle: {
      runtime: (id: string) => (id === "sample" ? (runtime as unknown as PluginRuntime) : null),
      state: (id: string) => (id === "sample" ? { status: "ready", startReason: "enable" } : null),
    },
  };
});

vi.mock("@/hooks/usePluginSurface", () => ({
  useInstalledPluginLifecycle: () => lifecycle,
  usePluginLaunchScanned: () => true,
  usePluginLifecycleRevision: () => 0,
  usePluginSurface: () => undefined,
  useStoppedPlugin: () => null,
}));

function seedPages(): void {
  setRegisteredContributions("sample", {
    pluginId: "sample",
    displayName: "Sample",
    commands: [],
    pages: [
      {
        pluginId: "sample",
        displayName: "Sample",
        localId: "report",
        id: "plugin.sample.report" as PluginContributionId,
        title: "Report",
        frame: "ui/report.html",
        commandId: "plugin.sample.open" as PluginCommandId,
      },
      {
        pluginId: "sample",
        displayName: "Sample",
        localId: "home",
        id: "plugin.sample.home" as PluginContributionId,
        title: "Home",
        commandId: "plugin.sample.open" as PluginCommandId,
      },
      {
        pluginId: "sample",
        displayName: "Sample",
        localId: "shelf",
        id: "plugin.sample.shelf" as PluginContributionId,
        title: "Shelf",
        hideTitle: true,
        commandId: "plugin.sample.open" as PluginCommandId,
      },
    ],
    sidebarEntries: [],
    itemMenuEntries: [],
    token: Symbol("sample"),
  });
  notifyContributionsChange();
}

function renderPage(pageId: string) {
  return render(
    <MemoryRouter initialEntries={[`/plugin/sample/${pageId}`]}>
      <Routes>
        <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  seedPages();
});

afterEach(() => {
  resetPluginContributionsForTests();
});

describe("PluginPage with a whole-page Frame", () => {
  it("renders a Frame for a page whose contribution declares frame", () => {
    const { container } = renderPage("report");
    expect(container.querySelector('[data-plugin-frame="page"]')).not.toBeNull();
  });

  it("renders no Frame for a page without frame (the Remote UI path)", () => {
    const { container } = renderPage("home");
    expect(container.querySelector("[data-plugin-frame]")).toBeNull();
  });
});

describe("the page around its content", () => {
  it("fits a Frame page to the viewport, so only the Frame scrolls", () => {
    const { container } = renderPage("report");
    const page = container.querySelector("[data-route-heading]")?.parentElement;
    expect(page?.className).toContain("overflow-hidden");
    expect(page?.className).not.toContain("overflow-y-auto");
    expect(container.textContent).not.toContain("Custom UI");
  });

  it("shows the title above a page by default", () => {
    const { getByRole } = renderPage("home");
    expect(getByRole("heading", { level: 1, name: "Home" }).className).not.toContain("sr-only");
  });

  it("keeps a hideTitle page's title for screen readers only", () => {
    const { getByRole } = renderPage("shelf");
    const heading = getByRole("heading", { level: 1, name: "Shelf" });
    expect(heading.className).toContain("sr-only");
    expect(heading.hasAttribute("data-route-heading")).toBe(true);
  });
});

describe("a page's frame reaches the contributions registry", () => {
  it("carries the declared frame path onto the page definition", () => {
    const folder = pluginFolder(
      { "ui/report.html": "<html><body></body></html>" },
      {
        id: "sample",
        name: "Sample",
        customUi: true,
        platforms: ["web", "desktop"],
        contributes: {
          commands: [{ id: "open", label: "Open", contexts: ["global"], navigates: true }],
          pages: [{ id: "report", title: "Report", command: "open", frame: "ui/report.html" }],
        },
      }
    );
    const read = readPluginManifest(folder);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));

    const unregister = registerPluginContributions({ manifest: read.manifest, folder });
    try {
      expect(getPluginPage("sample", "report")?.frame).toBe("ui/report.html");
      expect(getPluginPage("sample", "report")?.hideTitle).toBeUndefined();
    } finally {
      unregister();
    }
  });

  it("carries hideTitle onto the page definition, and accepts only true", () => {
    // `hideTitle: false` is the invalid case, so the type stays open.
    const manifest = (hideTitle: unknown) =>
      ({
        id: "sample",
        name: "Sample",
        platforms: ["web", "desktop"],
        contributes: {
          commands: [{ id: "open", label: "Open", contexts: ["global"], navigates: true }],
          pages: [{ id: "home", title: "Home", command: "open", hideTitle }],
        },
      }) as Parameters<typeof pluginFolder>[1];
    const folder = pluginFolder({}, manifest(true));
    const read = readPluginManifest(folder);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));
    const unregister = registerPluginContributions({ manifest: read.manifest, folder });
    try {
      expect(getPluginPage("sample", "home")?.hideTitle).toBe(true);
    } finally {
      unregister();
    }
    expect(readPluginManifest(pluginFolder({}, manifest(false))).ok).toBe(false);
  });
});
