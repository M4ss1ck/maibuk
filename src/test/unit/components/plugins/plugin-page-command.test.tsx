import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

let lifecycleStatus: "ready" | "stopped" = "ready";
let brokerRequest = vi.fn(async () => null);

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
    pluginId === "sample"
      ? lifecycleStatus === "ready"
        ? { status: "ready", startReason: "launch" }
        : { status: "stopped", reason: null, refusal: null }
      : null,
  runtime: (pluginId: string) =>
    pluginId === "sample" && lifecycleStatus === "ready"
      ? ({ broker: { request: brokerRequest }, stop: vi.fn() } as unknown as PluginRuntime)
      : null,
  launchScanned: () => true,
  onLaunchScanned: () => () => undefined,
} as unknown as PluginLifecycle;

const cleanups: Array<() => void> = [];

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "open", label: "Open report", contexts: ["global"], navigates: true },
          // A Command of the page's own Context: live only on that page.
          { id: "digest", label: "Digest", contexts: ["report"], defaults: [["Mod+Alt+j"]] },
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

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("PluginPage page-scoped Command", () => {
  it("runs its Command from its Shortcut on its page", async () => {
    registerSample();
    const user = userEvent.setup();

    renderPage();
    expect(screen.getByRole("heading", { name: "Sample report" })).toBeInTheDocument();

    await user.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", { id: "digest" });
  });

  it("binds nothing from the keyboard until its Plugin is ready", async () => {
    registerSample();
    lifecycleStatus = "stopped";
    const user = userEvent.setup();

    renderPage();
    await user.keyboard("{Control>}{Alt>}j{/Alt}{/Control}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });
});
