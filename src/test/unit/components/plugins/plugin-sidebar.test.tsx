import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { PluginPage } from "@/pages/PluginPage";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { readPluginManifest } from "@/features/plugins/runtime";
import {
  PLUGIN_SIDEBAR_SNAPSHOT_KEY,
  seedPluginSidebarFromSnapshot,
  writePluginSidebarSnapshot,
} from "@/features/plugins/sidebar-snapshot";
import type { PluginSidebarEntryDef } from "@/features/plugins/contributions-registry";
import { platformMismatchManifest, pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];

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
  state: () => ({ status: "stopped", reason: null, refusal: null }),
  runtime: () => null,
  installed: () => [],
  surfaceReached: () => undefined,
  surfaceLeft: () => undefined,
  launchScanned: () => true,
  onLaunchScanned: () => () => undefined,
} as unknown as import("@/features/plugins/types").PluginLifecycle;

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
        pages: [{ id: "report", title: "Sample report", command: "open" }],
        sidebarEntries: [{ page: "report", icon: "book-open" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

/** The #482 repro, registered without the validator (which now refuses it). */
function registerRepro(): void {
  cleanups.push(
    registerPluginContributions({
      manifest: platformMismatchManifest(),
      folder: { name: "probe", files: [] },
    })
  );
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  localStorage.removeItem(PLUGIN_SIDEBAR_SNAPSHOT_KEY);
});

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<div>Home</div>} />
          <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("Plugin sidebar entry via keyboard", () => {
  it("opens its page from the keyboard", async () => {
    registerSample();
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const nav = screen.getByRole("listbox", { name: "Primary navigation" });
    const entry = within(nav).getByRole("option", { name: /Sample report/ });
    expect(entry).toBeInTheDocument();

    // Arrow to the Plugin entry from the first option, Enter opens its page.
    const books = within(nav).getByRole("option", { name: /^Books/ });
    books.focus();
    await user.keyboard("{ArrowDown}");
    // Arrow until the Plugin entry has focus (it follows Maibuk's entries).
    for (let i = 0; i < 10 && document.activeElement !== entry; i += 1) {
      await user.keyboard("{ArrowDown}");
    }
    expect(entry).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample report" })).toBeInTheDocument();
    });
  });

  // #482: a sidebar entry whose page Command the platform filter dropped used
  // to reach the shell, where its Shortcut hint read a Command that is not in
  // the registry and crashed every route under Layout.
  it("renders every route when a contribution's Command was filtered out", () => {
    registerRepro();

    expect(() =>
      render(
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<div>Home</div>} />
              <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      )
    ).not.toThrow();

    const nav = screen.getByRole("listbox", { name: "Primary navigation" });
    expect(within(nav).queryByRole("option", { name: /Page/ })).toBeNull();
  });

  // The first frame knows the enabled Plugins' entries: they come from the last
  // launch's snapshot, before the scan registers the page Command.
  it("shows a saved entry in the first render and swaps in the scanned one", () => {
    savePluginApproval({
      pluginId: "sample",
      pinnedHash: "h1:any",
      granted: [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
    const saved: PluginSidebarEntryDef = {
      pluginId: "sample",
      displayName: "Sample",
      pageId: "report",
      pageRoute: "/plugin/sample/report",
      title: "Saved report",
      icon: "book-open",
      commandId: "plugin.sample.open" as PluginSidebarEntryDef["commandId"],
    };
    writePluginSidebarSnapshot([saved]);
    seedPluginSidebarFromSnapshot();

    // The seeded entry's Command is not registered: reading its Shortcut would throw.
    expect(() => renderShell()).not.toThrow();
    const nav = screen.getByRole("listbox", { name: "Primary navigation" });
    expect(within(nav).getByRole("option", { name: /Saved report/ })).toBeInTheDocument();

    act(() => registerSample());

    expect(within(nav).queryByRole("option", { name: /Saved report/ })).toBeNull();
    expect(within(nav).getByRole("option", { name: /Sample report/ })).toBeInTheDocument();
  });
});
