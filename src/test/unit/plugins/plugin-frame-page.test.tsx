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
      state: (id: string) =>
        id === "sample" ? { status: "ready", startReason: "enable" } : null,
    },
  };
});

vi.mock("@/hooks/usePluginSurface", () => ({
  useInstalledPluginLifecycle: () => lifecycle,
  usePluginLaunchScanned: () => true,
  usePluginLifecycleRevision: () => 0,
  usePluginSurface: () => undefined,
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
          pages: [
            { id: "report", title: "Report", command: "open", frame: "ui/report.html" },
          ],
        },
      }
    );
    const read = readPluginManifest(folder);
    if (!read.ok) throw new Error(JSON.stringify(read.problems));

    const unregister = registerPluginContributions({ manifest: read.manifest, folder });
    try {
      expect(getPluginPage("sample", "report")?.frame).toBe("ui/report.html");
    } finally {
      unregister();
    }
  });
});
