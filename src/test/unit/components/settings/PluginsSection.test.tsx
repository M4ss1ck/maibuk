/**
 * The Plugins Settings section (#442): one row per known Plugin, its origin
 * and state badges, the enable/approve action and the permission approval
 * dialog it opens, and the revoke controls for an approved copy — all driven
 * by keyboard. With zero Plugins the existing empty state stays.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import { PLUGIN_FILTER_CATEGORIES, usePluginManagementStore } from "@/features/plugins/management";
import { registerPluginSettingsRows } from "@/features/settings/rows";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { useSettingsStore } from "@/features/settings/store";
import type {
  PluginApproval,
  PluginManagementEntry,
  PluginManifest,
  PluginPermissionId,
  PluginReview,
} from "@/features/plugins/types";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

type User = ReturnType<typeof userEvent.setup>;

const { platformState, directory } = vi.hoisted(() => ({
  platformState: { kind: "web" as "web" | "desktop" | "android", supportsFolderPicker: false },
  directory: {
    openDirectory: vi.fn(async () => {}),
    changeDirectory: vi.fn(async () => true),
  },
}));

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return {
    ...actual,
    get IS_WEB() {
      return platformState.kind === "web";
    },
    get IS_DESKTOP() {
      return platformState.kind === "desktop";
    },
    get IS_ANDROID() {
      return platformState.kind === "android";
    },
    get IS_TAURI() {
      return platformState.kind !== "web";
    },
    getPluginDirectory: async () => ({
      kind: platformState.kind,
      supportsFolderPicker: platformState.supportsFolderPicker,
      listFolders: async () => [],
      readFolder: async () => null,
      openDirectory: directory.openDirectory,
      changeDirectory: directory.changeDirectory,
      addFromFolder: async () => null,
    }),
  };
});

const unregisters: Array<() => void> = [];

function manifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return { ...PLUGIN_MANIFEST, id: "echoes", name: "Echoes", ...overrides };
}

function approval(overrides: Partial<PluginApproval> = {}): PluginApproval {
  return {
    pluginId: "echoes",
    pinnedHash: "h1:x",
    granted: [],
    enabled: true,
    approvedVersion: "1.0.0",
    approvedPermissions: { required: [], optional: [] },
    approvedFiles: {},
    ...overrides,
  };
}

function review(overrides: Partial<PluginReview> = {}): PluginReview {
  return {
    status: "not-approved",
    files: { added: [], removed: [], changed: [] },
    permissions: { added: [], removed: [], nowRequired: [], nowOptional: [] },
    olderVersion: false,
    ...overrides,
  };
}

function entry(overrides: Partial<PluginManagementEntry> = {}): PluginManagementEntry {
  return {
    pluginId: "echoes",
    manifest: manifest(),
    approval: null,
    review: review(),
    running: false,
    builtIn: false,
    modified: false,
    updateAvailable: false,
    installed: true,
    removed: false,
    available: false,
    unsupported: false,
    duplicateFolders: [],
    stopped: null,
    ...overrides,
  };
}

function seed(...entries: PluginManagementEntry[]): void {
  usePluginManagementStore.setState({
    plugins: Object.fromEntries(entries.map((item) => [item.pluginId, item])),
  });
}

/** Tabs until `target` has focus, then asserts it. */
async function tabTo(user: User, target: HTMLElement, max = 14): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

async function openRow(user: User, name = "Echoes"): Promise<void> {
  const trigger = screen.getByRole("button", { name });
  await tabTo(user, trigger);
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  localStorage.clear();
  platformState.kind = "web";
  platformState.supportsFolderPicker = false;
  directory.openDirectory.mockClear();
  directory.changeDirectory.mockClear();
  useBoundShortcutStore.setState({ counts: {} });
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useSettingsRevealStore.setState({ pluginOpen: {}, pendingPluginReviewId: null });
  usePluginManagementStore.setState({
    plugins: {},
    notifications: [],
    refresh: async () => {},
    approve: async () => ({ ok: true }),
    revoke: async () => {},
    enable: async () => {},
    disable: () => {},
  });
});

afterEach(async () => {
  while (unregisters.length > 0) unregisters.pop()?.();
  await i18n.changeLanguage("en");
});

describe("PluginsSection", () => {
  it("keeps the empty state with zero Plugins", () => {
    render(<PluginsSection />);
    expect(screen.getByText("No Plugins yet")).toBeInTheDocument();
    expect(
      screen.getByText("Plugins you install appear here, each with its own settings.")
    ).toBeInTheDocument();
  });

  it("shows the name, Built-in badge, Review required badge, and startup error", () => {
    seed(
      entry({
        builtIn: true,
        approval: approval({ enabled: false, startupError: "Echoes failed to start." }),
        review: review({ status: "review-required" }),
      })
    );
    render(<PluginsSection />);
    expect(screen.getByRole("button", { name: "Echoes" })).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByText("Echoes failed to start.")).toBeInTheDocument();
  });

  it("approves a copy by keyboard and enables the Plugin", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({
          permissions: { required: ["library:read"], optional: ["network:api.example.com"] },
        }),
      })
    );
    const approve = vi.fn(async (pluginId: string, optionalGranted: PluginPermissionId[]) => {
      usePluginManagementStore.setState((state) => {
        const current = state.plugins[pluginId];
        if (!current) return {};
        return {
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...current,
              approval: approval({
                granted: [
                  ...current.manifest.permissions.required,
                  ...optionalGranted,
                ] as PluginPermissionId[],
                enabled: true,
                approvedPermissions: {
                  required: [...current.manifest.permissions.required],
                  optional: [...current.manifest.permissions.optional],
                },
              }),
              review: review({ status: "approved" }),
            },
          },
        };
      });
      return { ok: true as const };
    });
    usePluginManagementStore.setState({ approve });
    render(<PluginsSection />);

    await openRow(user);
    const reviewButton = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, reviewButton);
    await user.keyboard("{Enter}");

    const approveButton = await screen.findByRole("button", {
      name: "Approve this copy and enable",
    });
    // The prototype's "first" copy frames the decision above the permission rows.
    expect(
      screen.getByText(
        "Required permissions must be accepted to enable this Plugin. Optional permissions can stay off. No access is granted until you approve."
      )
    ).toBeInTheDocument();
    await tabTo(user, approveButton);
    await user.keyboard("{Enter}");

    expect(approve).toHaveBeenCalledWith("echoes", ["network:api.example.com"]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument()
    );
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("revoking an optional permission keeps the Plugin enabled", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({
          permissions: { required: ["library:read"], optional: ["network:api.example.com"] },
        }),
        approval: approval({ granted: ["library:read", "network:api.example.com"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    const revoke = vi.fn(async (pluginId: string, permission: PluginPermissionId) => {
      usePluginManagementStore.setState((state) => {
        const current = state.plugins[pluginId];
        if (!current?.approval) return {};
        return {
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...current,
              approval: {
                ...current.approval,
                granted: current.approval.granted.filter((item) => item !== permission),
              },
            },
          },
        };
      });
    });
    const disable = vi.fn();
    usePluginManagementStore.setState({ revoke, disable });
    render(<PluginsSection />);

    await openRow(user);
    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    await tabTo(user, optional);
    await user.keyboard(" ");

    expect(revoke).toHaveBeenCalledWith("echoes", "network:api.example.com");
    expect(disable).not.toHaveBeenCalled();
    await waitFor(() => expect(optional).not.toBeChecked());
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("locks the inline permission toggles on a copy that needs review", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({
          permissions: { required: ["library:read"], optional: ["network:api.example.com"] },
        }),
        approval: approval({ granted: ["library:read"], enabled: false }),
        review: review({ status: "review-required" }),
      })
    );
    const approve = vi.fn(async () => ({ ok: true as const }));
    usePluginManagementStore.setState({ approve });
    render(<PluginsSection />);

    await openRow(user);
    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    // A changed copy must be reviewed first: the inline toggle is not operable.
    expect(optional).toBeDisabled();
    await user.keyboard(" ");
    expect(approve).not.toHaveBeenCalled();
  });

  it("revoking a required permission disables the Plugin and shows requiredMissing", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({ permissions: { required: ["library:read"], optional: [] } }),
        approval: approval({ granted: ["library:read"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    const revoke = vi.fn(async (pluginId: string, permission: PluginPermissionId) => {
      usePluginManagementStore.setState((state) => {
        const current = state.plugins[pluginId];
        if (!current?.approval) return {};
        return {
          plugins: {
            ...state.plugins,
            [pluginId]: {
              ...current,
              approval: {
                ...current.approval,
                granted: current.approval.granted.filter((item) => item !== permission),
                enabled: false,
              },
            },
          },
        };
      });
    });
    usePluginManagementStore.setState({ revoke });
    render(<PluginsSection />);

    await openRow(user);
    const revokeButton = screen.getByRole("button", {
      name: "Disable Plugin and revoke access",
    });
    await tabTo(user, revokeButton);
    await user.keyboard("{Enter}");

    expect(revoke).toHaveBeenCalledWith("echoes", "library:read");
    await waitFor(() =>
      expect(
        screen.getByText(
          "Required access is missing. Review and approve it to enable this Plugin."
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review and enable" })).toBeInTheDocument();
  });

  it("keeps a Plugin's declared Settings rows in its expanded row", async () => {
    const user = userEvent.setup();
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );
    seed(entry());
    render(<PluginsSection />);

    await openRow(user);
    expect(await screen.findByLabelText("Echo threshold")).toBeInTheDocument();
  });

  it("shows Modified Built-in copy and Update available badges", () => {
    seed(
      entry({
        builtIn: true,
        modified: true,
        updateAvailable: true,
        approval: approval({ builtIn: { shippedHash: "h1:ship" } }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);
    expect(screen.getByText("Modified Built-in copy")).toBeInTheDocument();
    expect(screen.getByText("Update available")).toBeInTheDocument();
  });

  it("localizes a startup error code on the row", () => {
    seed(entry({ approval: approval({ startupError: "incompatible" }) }));
    render(<PluginsSection />);
    expect(screen.getByText("This Plugin needs a newer version of Maibuk.")).toBeInTheDocument();
  });

  it("keeps a modified copy by keyboard without re-notifying", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        builtIn: true,
        modified: true,
        updateAvailable: true,
        approval: approval({ builtIn: { shippedHash: "h1:ship" } }),
        review: review({ status: "approved" }),
      })
    );
    const keepMyCopy = vi.fn(async () => {});
    usePluginManagementStore.setState({ keepMyCopy });
    render(<PluginsSection />);

    await openRow(user);
    const keep = screen.getByRole("button", { name: "Keep my copy" });
    await tabTo(user, keep);
    await user.keyboard("{Enter}");

    expect(keepMyCopy).toHaveBeenCalledWith("echoes");
    // The update stays offered, and nothing was notified again.
    expect(screen.getByText("Update available")).toBeInTheDocument();
    expect(usePluginManagementStore.getState().notifications).toEqual([]);
  });

  it("replaces a modified copy only after confirming in the dialog", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        builtIn: true,
        modified: true,
        updateAvailable: true,
        approval: approval({ builtIn: { shippedHash: "h1:ship" } }),
        review: review({ status: "approved" }),
      })
    );
    const replaceBuiltIn = vi.fn(async () => true);
    usePluginManagementStore.setState({ replaceBuiltIn });
    render(<PluginsSection />);

    await openRow(user);
    const openReplace = screen.getByRole("button", { name: "Replace modified copy" });
    await tabTo(user, openReplace);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // Escape cancels: nothing replaced.
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(replaceBuiltIn).not.toHaveBeenCalled();

    // Reopen and confirm.
    await tabTo(user, screen.getByRole("button", { name: "Replace modified copy" }));
    await user.keyboard("{Enter}");
    const confirm = await screen.findByRole("alertdialog");
    const confirmButton = within(confirm).getByRole("button", { name: "Replace modified copy" });
    await tabTo(user, confirmButton);
    await user.keyboard("{Enter}");

    expect(replaceBuiltIn).toHaveBeenCalledWith("echoes", true);
  });

  it("reviews a changed copy by keyboard and approves it", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        approval: approval({ enabled: false }),
        review: review({
          status: "review-required",
          files: { added: ["fresh.js"], removed: [], changed: [] },
        }),
      })
    );
    const markReviewed = vi.fn(async () => {});
    usePluginManagementStore.setState({ markReviewed });
    render(<PluginsSection />);

    await openRow(user);
    const reviewButton = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, reviewButton);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("fresh.js")).toBeInTheDocument();
    const approve = within(dialog).getByRole("button", { name: "Approve this copy and enable" });
    await tabTo(user, approve);
    await user.keyboard("{Enter}");

    expect(markReviewed).toHaveBeenCalled();
  });

  it("opens the review dialog when a notice asks for it", async () => {
    seed(entry({ review: review({ status: "review-required" }) }));
    useSettingsRevealStore.setState({ pendingPluginReviewId: "echoes" });
    render(<PluginsSection />);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(useSettingsRevealStore.getState().pendingPluginReviewId).toBeNull();
  });

  it("toggles Development mode by keyboard and refreshes the store", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    usePluginManagementStore.setState({ refresh });
    render(<PluginsSection />);
    refresh.mockClear();

    const toggle = screen.getByRole("switch", { name: "Development mode" });
    await tabTo(user, toggle);
    await user.keyboard(" ");

    expect(useSettingsStore.getState().pluginDevelopmentMode).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });
});

/** ArrowDown until the filter option owns focus, then assert it. */
async function focusFilterOption(user: User, option: HTMLElement): Promise<void> {
  for (
    let i = 0;
    i < PLUGIN_FILTER_CATEGORIES.length + 1 && document.activeElement !== option;
    i++
  ) {
    await user.keyboard("{ArrowDown}");
  }
  expect(document.activeElement).toBe(option);
}

describe("Plugin management (#443)", () => {
  it("adds a Plugin by keyboard and opens its approval flow", async () => {
    const user = userEvent.setup();
    const addFromZip = vi.fn(async () => {
      usePluginManagementStore.setState((state) => ({
        plugins: {
          ...state.plugins,
          echoes: entry({ review: review({ status: "not-approved" }) }),
        },
      }));
      return "echoes";
    });
    usePluginManagementStore.setState({ addFromZip });
    render(<PluginsSection />);

    const addButton = screen.getByRole("button", { name: "Add Plugin" });
    await tabTo(user, addButton, 20);
    await user.keyboard("{Enter}");

    expect(addFromZip).toHaveBeenCalledTimes(1);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Approve this copy and enable" })
    ).toBeInTheDocument();
  });

  it("opens nothing when the add picker is cancelled", async () => {
    const user = userEvent.setup();
    const addFromZip = vi.fn(async () => null);
    usePluginManagementStore.setState({ addFromZip });
    render(<PluginsSection />);

    const addButton = screen.getByRole("button", { name: "Add Plugin" });
    await tabTo(user, addButton, 20);
    await user.keyboard("{Enter}");

    expect(addFromZip).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the management error copy in a toast when an add fails", async () => {
    const user = userEvent.setup();
    const addFromZip = vi.fn(async () => {
      throw new Error("The Plugin .zip could not be read");
    });
    usePluginManagementStore.setState({ addFromZip });
    const errorSpy = vi.spyOn(toast, "error").mockImplementation(() => {});
    render(<PluginsSection />);

    const addButton = screen.getByRole("button", { name: "Add Plugin" });
    await tabTo(user, addButton, 20);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(errorSpy).toHaveBeenCalledWith("Could not add the Plugin."));
    errorSpy.mockRestore();
  });

  it("starts with every filter category selected", () => {
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    render(<PluginsSection />);

    expect(screen.getByRole("button", { name: "Filter by status" })).toHaveTextContent(
      "All statuses"
    );
    expect(screen.getByRole("button", { name: "Echoes" })).toBeInTheDocument();
  });

  it("deselecting a category hides only the rows that belong to it (ANY match)", async () => {
    const user = userEvent.setup();
    const installedOnly = entry({
      pluginId: "alpha",
      manifest: manifest({ id: "alpha", name: "Alpha" }),
      approval: approval({ enabled: true }),
      review: review({ status: "approved" }),
    });
    const available = entry({
      pluginId: "beta",
      manifest: manifest({ id: "beta", name: "Beta" }),
      installed: false,
      builtIn: true,
      available: true,
    });
    seed(installedOnly, available);
    render(<PluginsSection />);

    expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Filter by status" });
    await tabTo(user, trigger, 20);
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await focusFilterOption(user, screen.getByRole("option", { name: /Installed/ }));
    await user.keyboard(" ");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("button", { name: "Alpha" })).toBeNull());
    // Beta stays: ANY semantics, and it still matches Built-in / Available.
    expect(screen.getByRole("button", { name: "Beta" })).toBeInTheDocument();
  });

  it("shows the empty-result copy when no category matches", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    render(<PluginsSection />);

    const trigger = screen.getByRole("button", { name: "Filter by status" });
    await tabTo(user, trigger, 20);
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await focusFilterOption(user, screen.getByRole("option", { name: /Installed/ }));
    for (let i = 0; i < PLUGIN_FILTER_CATEGORIES.length; i++) {
      if (i > 0) await user.keyboard("{ArrowDown}");
      await user.keyboard(" ");
    }
    await user.keyboard("{Escape}");

    expect(await screen.findByText("No Plugins match these filters.")).toBeInTheDocument();
  });

  it("shows a Stopped row's reason and restarts it by keyboard", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        approval: approval({ enabled: true }),
        review: review({ status: "approved" }),
        stopped: { reason: "crashed" },
      })
    );
    const restart = vi.fn(async () => {});
    usePluginManagementStore.setState({ restart });
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("Stopped because it exceeded the runtime limit.")).toBeInTheDocument();

    const restartButton = screen.getByRole("button", { name: "Restart" });
    await tabTo(user, restartButton);
    await user.keyboard("{Enter}");
    expect(restart).toHaveBeenCalledWith("echoes");
  });

  it("explains an Unsupported row and disables its enable control", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        unsupported: true,
        manifest: manifest({ platforms: ["desktop"] }),
        approval: approval({ enabled: false }),
        review: review({ status: "approved" }),
      })
    );
    const enable = vi.fn(async () => {});
    usePluginManagementStore.setState({ enable });
    render(<PluginsSection />);

    await openRow(user);
    expect(
      screen.getByText("Unavailable on this device. This Plugin supports desktop only.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeDisabled();
    expect(enable).not.toHaveBeenCalled();
  });

  it("names both folders on a duplicate-id row", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        duplicateFolders: ["echoes", "echoes-copy"],
        approval: approval({ enabled: false }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    expect(
      screen.getByText(
        "Two folders declare this Plugin id: echoes, echoes-copy. Remove one of them to enable it."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enable" })).toBeDisabled();
  });

  it("keeps desktop-only directory buttons off web", () => {
    platformState.kind = "web";
    seed(entry());
    render(<PluginsSection />);

    expect(screen.queryByRole("button", { name: "Open Plugin Directory" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change Plugin Directory" })).toBeNull();
  });

  it("opens and changes the Plugin Directory from desktop", async () => {
    const user = userEvent.setup();
    platformState.kind = "desktop";
    seed(entry());
    render(<PluginsSection />);

    const open = screen.getByRole("button", { name: "Open Plugin Directory" });
    await tabTo(user, open, 20);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(directory.openDirectory).toHaveBeenCalled());

    const change = screen.getByRole("button", { name: "Change Plugin Directory" });
    await tabTo(user, change, 20);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(directory.changeDirectory).toHaveBeenCalled());
  });

  it("registers the management Commands for the desktop set only", async () => {
    platformState.kind = "desktop";
    render(<PluginsSection />);
    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["settings.openPluginDirectory"]
      ).toBeGreaterThan(0)
    );
    expect(useBoundShortcutStore.getState().counts["settings.addPlugin"]).toBeGreaterThan(0);
    expect(
      useBoundShortcutStore.getState().counts["settings.changePluginDirectory"]
    ).toBeGreaterThan(0);
  });

  it("leaves the directory Commands unbound for the web set", async () => {
    platformState.kind = "web";
    render(<PluginsSection />);
    await waitFor(() =>
      expect(useBoundShortcutStore.getState().counts["settings.addPlugin"]).toBeGreaterThan(0)
    );
    expect(useBoundShortcutStore.getState().counts["settings.openPluginDirectory"]).toBeUndefined();
    expect(
      useBoundShortcutStore.getState().counts["settings.changePluginDirectory"]
    ).toBeUndefined();
  });
});
