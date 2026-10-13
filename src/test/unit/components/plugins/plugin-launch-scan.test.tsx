/**
 * The lifecycle installs before its launch scan finishes (it waits for the
 * Library, the launch Auto Sync, and the launch Backup), so a Plugin page
 * mounted during launch must show loading until the scan has settled — the
 * registry it reads is half-empty until then — and only then report a
 * missing Plugin.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import type { PluginLifecycle } from "@/features/plugins/types";
import type { PluginDirectoryAdapter } from "@/lib/platform/types";
import { PluginPage } from "@/pages/PluginPage";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const directory: PluginDirectoryAdapter = {
  kind: "web",
  listFolders: async () => [],
  readFolder: async () => null,
};

const appDirectory = async (
  folder: Awaited<ReturnType<typeof pluginFolder>>
): Promise<PluginDirectoryAdapter> => ({
  kind: "web",
  listFolders: async () => ["sample"],
  readFolder: async () => folder,
});

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
  resetPluginLifecycleForTests();
  resetPluginContributionsForTests();
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
});

describe("PluginPage while the launch scan is pending", () => {
  it("shows loading until the scan settles, then reports the missing Plugin", async () => {
    let settleLaunch!: () => void;
    const gate = new Promise<void>((resolve) => {
      settleLaunch = resolve;
    });
    const lifecycle: PluginLifecycle = createPluginLifecycle({
      directory,
      scheduleIdle: (work) => work(),
      whenLaunchSettled: () => gate,
      dataVersions: { get: async () => null, set: async () => undefined },
    });
    setPluginLifecycleInstance(lifecycle);
    void lifecycle.launch(); // PARKED at the launch gate; the instance is installed

    renderPage();
    expect(screen.getByRole("heading").textContent).not.toMatch(/not installed/i);
    expect(screen.getByText(/loading|Cargando/i)).toBeInTheDocument();

    await act(async () => {
      settleLaunch();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Plugin page" })).toBeInTheDocument();
    });
    expect(screen.getByText(/not installed|no está instalado/i)).toBeInTheDocument();
  });

  it("shows the registered Plugin page once the scan settled", async () => {
    let settleLaunch!: () => void;
    const gate = new Promise<void>((resolve) => {
      settleLaunch = resolve;
    });
    const folder = pluginFolder(
      {},
      {
        id: "sample",
        name: "Sample",
        platforms: ["desktop"],
        contributes: {
          commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
          pages: [{ id: "report", title: "Sample report", command: "open" }],
        },
      }
    );
    savePluginApproval({
      pluginId: "sample",
      pinnedHash: await hashPluginDirectory(folder.files),
      granted: [],
      enabled: true,
      approvedVersion: "",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    });
    const lifecycle = createPluginLifecycle({
      directory: await appDirectory(folder),
      scheduleIdle: (work) => work(),
      whenLaunchSettled: () => gate,
      dataVersions: { get: async () => null, set: async () => undefined },
    });
    setPluginLifecycleInstance(lifecycle);
    void lifecycle.launch(); // PARKED at the launch gate

    renderPage();
    expect(screen.getByText(/loading|Cargando/i)).toBeInTheDocument();

    await act(async () => {
      settleLaunch();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample report" })).toBeInTheDocument();
    });
  });
});
