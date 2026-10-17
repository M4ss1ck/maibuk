/**
 * A Toggle Button end to end (Plugin toolbar, #toggle): the manifest declares
 * `toggle: true`, the Plugin sets its pressed state through the real
 * `toolbar.setPressed` handler, and the editor toolbar shows it. A stopped
 * Plugin never leaves its button showing on. Keyboard use goes through
 * `user-event` key presses.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PluginToolbarButton } from "@/components/plugins/PluginToolbarButton";
import { PLUGIN_APPROVALS_STORAGE_KEY, savePluginApproval } from "@/features/plugins/approvals";
import { resetPluginContributionsForTests } from "@/features/plugins/contributions";
import { hashPluginDirectory } from "@/features/plugins/directory-hash";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { createPluginLifecycle } from "@/features/plugins/lifecycle";
import { setPluginLifecycleInstance } from "@/features/plugins/lifecycle-instance";
import { clearToolbarPressed } from "@/features/plugins/toolbar-pressed";
import type { PluginLifecycle, PluginManifest } from "@/features/plugins/types";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import {
  PLUGIN_MANIFEST,
  fakePluginFrame,
  installMicrotaskMessageChannel,
  pluginFolder,
  type FakePluginFrame,
} from "@/test/support/plugin-fixtures";

const SAMPLE_MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  id: "sample",
  name: "Sample",
  platforms: ["desktop"],
  lifecycle: "persistent",
  contributes: {
    commands: [
      { id: "open", label: "Open report", contexts: ["global"] },
      { id: "refresh", label: "Refresh", contexts: ["global"] },
    ],
    toolbarButtons: [
      { id: "toggleButton", command: "refresh", icon: "book-open", toggle: true },
      { id: "plainButton", command: "open", icon: "book-open" },
    ],
  },
};

let restoreMessageChannel: (() => void) | null = null;
let lifecycle: PluginLifecycle | null = null;
let frames: FakePluginFrame[] = [];

beforeEach(() => {
  restoreMessageChannel = installMicrotaskMessageChannel();
  frames = [];
});

afterEach(() => {
  lifecycle?.dispose();
  lifecycle = null;
  setPluginLifecycleInstance(null);
  restoreMessageChannel?.();
  restoreMessageChannel = null;
  localStorage.removeItem(PLUGIN_APPROVALS_STORAGE_KEY);
  resetPluginContributionsForTests();
  clearToolbarPressed("sample");
});

/** Launches the approved sample Plugin and installs its lifecycle as the app's one. */
async function launchSample(): Promise<PluginLifecycle> {
  const folder = pluginFolder({}, SAMPLE_MANIFEST);
  savePluginApproval({
    pluginId: "sample",
    pinnedHash: await hashPluginDirectory(folder.files),
    granted: [],
    enabled: true,
    approvedVersion: "",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
  });
  const created = createPluginLifecycle({
    directory: {
      kind: "desktop",
      listFolders: async () => ["sample"],
      readFolder: async () => folder,
    },
    createFrame: () => {
      const frame = fakePluginFrame();
      frames.push(frame);
      return frame;
    },
    scheduleIdle: (work) => work(),
    whenLaunchSettled: async () => undefined,
    dataVersions: { get: async () => null, set: async () => undefined },
  });
  lifecycle = created;
  setPluginLifecycleInstance(created);
  await created.launch();
  await waitFor(() => expect(created.state("sample")?.status).toBe("ready"));
  return created;
}

function renderToolbar(id: "toggleButton" | "plainButton"): void {
  render(
    <MemoryRouter initialEntries={["/book/b1"]}>
      <PluginToolbarButton id={`plugin.sample.${id}`} iconSize="md" />
    </MemoryRouter>
  );
}

/** The real `toolbar.setPressed` handler, the way the broker reaches it. */
async function setPressedAsPlugin(button: string, pressed: boolean): Promise<void> {
  const setPressed = createPluginHandlers(SAMPLE_MANIFEST)["toolbar.setPressed"];
  if (!setPressed) throw new Error("toolbar.setPressed is not wired");
  await setPressed({ button, pressed }, { pluginId: "sample" });
}

describe("a Toggle Button in the editor toolbar", () => {
  it("is off until its Plugin sets it on, then on, then off again", async () => {
    await launchSample();
    renderToolbar("toggleButton");
    const button = screen.getByRole("button", { name: "Refresh", pressed: false });
    expect(button).toBeEnabled();

    await act(async () => {
      await setPressedAsPlugin("toggleButton", true);
    });
    expect(screen.getByRole("button", { name: "Refresh", pressed: true })).toBeInTheDocument();

    await act(async () => {
      await setPressedAsPlugin("toggleButton", false);
    });
    expect(screen.getByRole("button", { name: "Refresh", pressed: false })).toBeInTheDocument();
  });

  it("shows off again once its Plugin stops, even if it was set on", async () => {
    const plugin = await launchSample();
    renderToolbar("toggleButton");
    await act(async () => {
      await setPressedAsPlugin("toggleButton", true);
    });
    expect(screen.getByRole("button", { name: "Refresh", pressed: true })).toBeInTheDocument();

    act(() => {
      plugin.stop("sample");
    });

    expect(screen.getByRole("button", { name: "Refresh", pressed: false })).toBeDisabled();
  });

  it("has no pressed state on a button that is not a Toggle Button", async () => {
    await launchSample();
    renderToolbar("plainButton");

    expect(screen.getByRole("button", { name: "Open report" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open report", pressed: false })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open report", pressed: true })).toBeNull();
  });

  it("runs its Command from the keyboard and does not flip its own pressed state", async () => {
    await launchSample();
    renderToolbar("toggleButton");
    const user = userEvent.setup();

    await user.tab();
    const button = screen.getByRole("button", { name: "Refresh", pressed: false });
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(frames[0].requests).toContain(PLUGIN_COMMAND_RUN_REQUEST));
    expect(screen.getByRole("button", { name: "Refresh", pressed: false })).toBeInTheDocument();
  });
});
