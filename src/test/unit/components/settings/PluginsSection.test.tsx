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
import { useModalStore } from "@/components/ui/modal-store";
import { usePluginManagementStore } from "@/features/plugins/management";
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
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

type User = ReturnType<typeof userEvent.setup>;

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
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useSettingsRevealStore.setState({ pluginOpen: {}, pendingPluginReviewId: null });
  usePluginManagementStore.setState({
    plugins: {},
    notifications: [],
    refresh: async () => {},
    approve: async () => {},
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
