/**
 * The Plugins Settings section (#442): one row per known Plugin, its origin
 * and state badges, the enable/approve action and the permission approval
 * dialog it opens, and the revoke controls for an approved copy — all driven
 * by keyboard. With zero Plugins the existing empty state stays.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { PluginsSection } from "@/components/settings/PluginsSection";
import { toast } from "@/components/ui/Toast";
import { useModalStore } from "@/components/ui/modal-store";
import { PLUGIN_FILTER_CATEGORIES, PLUGIN_DATA_SIZE_WARNING_BYTES, usePluginManagementStore } from "@/features/plugins/management";
import {
  resetPluginLifecycleForTests,
  setPluginLifecycleInstance,
} from "@/features/plugins/lifecycle-instance";
import { createTestHost } from "@/features/plugins/test-kit";
import { registerPluginSecretStore, type PluginSecretStore } from "@/features/plugins/secret-store";
import { registerPluginSettingsRows } from "@/features/settings/rows";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { useSettingsStore } from "@/features/settings/store";
import type {
  PluginApproval,
  PluginLifecycle,
  PluginManagementEntry,
  PluginManifest,
  PluginPermissionId,
  PluginReview,
  PluginRuntime,
} from "@/features/plugins/types";
import { createPluginClient } from "@/plugin-sdk";
import { ui } from "@/plugin-sdk/ui";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import { useBoundShortcutStore } from "@/lib/bound-shortcuts";
import { runCommand } from "@/lib/command-runner";
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
    locales: {},
    ...overrides,
  };
}

function seed(...entries: PluginManagementEntry[]): void {
  usePluginManagementStore.setState({
    plugins: Object.fromEntries(entries.map((item) => [item.pluginId, item])),
  });
}

/** A Plugin secret store whose overrides stand in for the registered one. */
function secretStore(overrides: Partial<PluginSecretStore> = {}): PluginSecretStore {
  return {
    set: async () => {},
    delete: async () => {},
    listNames: async () => [],
    read: async () => null,
    clearPlugin: async () => {},
    clearAll: async () => {},
    ...overrides,
  };
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
  // The disclosure trigger's accessible name carries the badges too, so a
  // substring match finds the row by its name alone.
  const trigger = screen.getByRole("button", { name: new RegExp(name) });
  await tabTo(user, trigger);
  await user.keyboard("{Enter}");
}

/** Expands the nested Permissions accordion inside an open card. */
async function openPermissions(user: User): Promise<void> {
  const trigger = screen.getByRole("button", { name: /Plugin permissions/ });
  await tabTo(user, trigger, 40);
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  localStorage.clear();
  registerPluginSecretStore(null);
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
    dataSizes: {},
    refresh: async () => {},
    approve: async () => ({ ok: true }),
    revoke: async () => {},
    enable: async () => {},
    disable: () => {},
    refreshDataSize: async () => {},
  });
});

afterEach(async () => {
  while (unregisters.length > 0) unregisters.pop()?.();
  registerPluginSecretStore(null);
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

  it("shows the name, Built-in badge, Review required badge, Failed to start, and no status badge", () => {
    seed(
      entry({
        builtIn: true,
        approval: approval({ enabled: false, startupError: "Echoes failed to start." }),
        review: review({ status: "review-required" }),
      })
    );
    render(<PluginsSection />);
    expect(screen.getByRole("button", { name: /Echoes/ })).toBeInTheDocument();
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Review required")).toBeInTheDocument();
    // The startup error becomes an issue badge; the full text lives in the panel.
    expect(screen.getByText("Failed to start")).toBeInTheDocument();
    expect(screen.getByText("Echoes failed to start.")).toBeInTheDocument();
    // The old Enabled / Off status badge is gone.
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByText("Enabled")).toBeNull();
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

    // Turning the header switch on for a copy that needs review opens the
    // approval flow; the switch itself stays off until the store says enabled.
    const toggle = screen.getByRole("switch", { name: "Enable Echoes" });
    await tabTo(user, toggle);
    await user.keyboard(" ");

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
      expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeChecked()
    );
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
    await openPermissions(user);
    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    await tabTo(user, optional);
    await user.keyboard(" ");

    expect(revoke).toHaveBeenCalledWith("echoes", "network:api.example.com");
    expect(disable).not.toHaveBeenCalled();
    await waitFor(() => expect(optional).not.toBeChecked());
    expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeChecked();
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
    await openPermissions(user);
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
    await openPermissions(user);
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
    expect(screen.getByRole("switch", { name: "Enable Echoes" })).not.toBeChecked();
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
    // The row anchor carries the declaration's label; the live controls come
    // from the Plugin's own Remote UI body (proved in the test below).
    const row = document.querySelector('[data-settings-row="plugin.echoes.threshold"]');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Echo threshold")).toBeInTheDocument();
  });

  it("stacks a Plugin Settings row so its tall body takes the full width", async () => {
    const user = userEvent.setup();
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [
          {
            id: "threshold",
            label: "Echo threshold",
            description: "How alike two passages must be",
          },
        ],
      })
    );
    seed(entry());
    render(<PluginsSection />);

    await openRow(user);

    const row = document.querySelector<HTMLElement>(
      '[data-settings-row="plugin.echoes.threshold"]'
    );
    expect(row).not.toBeNull();
    // The stacked shell: label and description on top, the Plugin's body below
    // at full width — never the label-left/control-right shell the simple rows
    // use, which left the label floating in a wide column beside tall controls.
    expect(row).toHaveClass("flex-col");
    expect(row).toHaveClass("py-3");
    expect(row).not.toHaveClass("@lg:flex-row");
    const labelBlock = row!.firstElementChild as HTMLElement;
    expect(within(labelBlock).getByText("Echo threshold")).toBeInTheDocument();
    expect(within(labelBlock).getByText("How alike two passages must be")).toBeInTheDocument();
  });

  it("shows Modified and Update available badges", () => {
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
    expect(screen.getByText("Modified")).toBeInTheDocument();
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

    // The header switch opens the changed-files review for a review-required copy.
    const toggle = screen.getByRole("switch", { name: "Enable Echoes" });
    await tabTo(user, toggle);
    await user.keyboard(" ");

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

describe("Plugin card header (#442)", () => {
  it("expands and collapses the card from the keyboard", async () => {
    const user = userEvent.setup();
    seed(entry());
    render(<PluginsSection />);

    const trigger = screen.getByRole("button", { name: /^Echoes/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Library data")).not.toBeVisible();

    await tabTo(user, trigger);
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Library data")).toBeVisible();

    await user.keyboard(" ");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Library data")).not.toBeVisible();
  });

  it("tabs from the trigger to the switch and turns an approved copy on", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: false }), review: review({ status: "approved" }) }));
    const enable = vi.fn(async (pluginId: string) => {
      usePluginManagementStore.setState((state) => ({
        plugins: {
          ...state.plugins,
          [pluginId]: {
            ...state.plugins[pluginId],
            approval: approval({ enabled: true }),
          },
        },
      }));
    });
    usePluginManagementStore.setState({ enable });
    render(<PluginsSection />);

    await tabTo(user, screen.getByRole("button", { name: /^Echoes/ }));
    const toggle = screen.getByRole("switch", { name: "Enable Echoes" });
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    expect(toggle).not.toBeChecked();

    await user.keyboard(" ");
    expect(enable).toHaveBeenCalledWith("echoes");
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("turns an enabled Plugin off with the switch", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    const disable = vi.fn();
    usePluginManagementStore.setState({ disable });
    render(<PluginsSection />);

    const toggle = screen.getByRole("switch", { name: "Enable Echoes" });
    expect(toggle).toBeChecked();
    await tabTo(user, toggle);
    await user.keyboard(" ");

    expect(disable).toHaveBeenCalledWith("echoes");
  });

  it("opens the review dialog from the switch of a copy that needs review and stays off", async () => {
    const user = userEvent.setup();
    seed(entry({ review: review({ status: "review-required" }) }));
    render(<PluginsSection />);

    const toggle = screen.getByRole("switch", { name: "Enable Echoes" });
    await tabTo(user, toggle);
    await user.keyboard(" ");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // The switch follows the store, so it stays off until the copy is approved.
    expect(toggle).not.toBeChecked();
  });

  it("disables the switch for an unsupported entry and hides it for a removed one", () => {
    seed(
      entry({
        unsupported: true,
        manifest: manifest({ platforms: ["desktop"] }),
        approval: approval({ enabled: false }),
        review: review({ status: "approved" }),
      }),
      entry({
        pluginId: "gone",
        manifest: manifest({ id: "gone", name: "Gone" }),
        installed: false,
        removed: true,
      })
    );
    render(<PluginsSection />);

    expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeDisabled();
    expect(screen.queryByRole("switch", { name: "Enable Gone" })).toBeNull();
  });

  it("shows the Failed to start badge when a startup error is recorded", () => {
    seed(entry({ approval: approval({ enabled: false, startupError: "incompatible" }) }));
    render(<PluginsSection />);

    expect(screen.getByText("Failed to start")).toBeInTheDocument();
    // The old status badge is gone and the switch replaces its role.
    expect(screen.queryByText("Enabled")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeInTheDocument();
  });

  it("localizes the card name to the UI language", async () => {
    seed(entry({ locales: { es: { name: "Ecos" } } }));
    await i18n.changeLanguage("es");
    try {
      render(<PluginsSection />);
      expect(screen.getByRole("button", { name: /^Ecos/ })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});

describe("Plugin card body (#442)", () => {
  it("opens the panel with the localized manifest description", async () => {
    const user = userEvent.setup();
    seed(entry({ manifest: manifest({ description: "Find repeated passages." }) }));
    render(<PluginsSection />);

    await openRow(user);

    // The panel's first child is the description, so a reader meets what the
    // Plugin is before its notices and controls.
    const trigger = screen.getByRole("button", { name: /^Echoes/ });
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel?.firstElementChild).toHaveTextContent("Find repeated passages.");
    expect(screen.getByText("Find repeated passages.")).toBeInTheDocument();
  });

  it("animates the card panel", async () => {
    seed(entry());
    render(<PluginsSection />);

    const trigger = screen.getByRole("button", { name: /^Echoes/ });
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    // jsdom cannot run the animation; the transition classes are the contract.
    expect(panel).toHaveClass("motion-reduce:transition-none");
    expect(panel?.className).toContain("transition-[height,opacity]");
    expect(panel?.className).toContain("h-(--disclosure-panel-height)");
  });

  it("expands and collapses the Permissions accordion from the keyboard", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({ permissions: { required: ["library:read"], optional: [] } }),
        approval: approval({ granted: ["library:read"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    const trigger = screen.getByRole("button", { name: /Plugin permissions/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: /Read your Library/ })).toBeNull();

    await tabTo(user, trigger, 40);
    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByRole("checkbox", { name: /Read your Library/ })).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() =>
      expect(screen.queryByRole("checkbox", { name: /Read your Library/ })).toBeNull()
    );
  });

  it("flags a changed copy and opens its review from the accordion", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({ permissions: { required: ["library:read"], optional: [] } }),
        approval: approval({ granted: ["library:read"], enabled: false }),
        review: review({ status: "review-required" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();

    await openPermissions(user);
    expect(
      screen.getByText("This copy changed since you approved it. Review it to turn it on.")
    ).toBeInTheDocument();

    const reviewButton = screen.getByRole("button", { name: "Review" });
    await tabTo(user, reviewButton, 40);
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("flags a missing required grant with its own explanation", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({ permissions: { required: ["library:read"], optional: [] } }),
        approval: approval({ granted: [], enabled: false }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();

    await openPermissions(user);
    expect(screen.getByText("A permission this Plugin needs is not granted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  it("flags a never-approved copy and keeps its permission list hidden", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({ permissions: { required: ["library:read"], optional: [] } }),
        approval: null,
        review: review({ status: "not-approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.getByText("Needs attention")).toBeInTheDocument();

    await openPermissions(user);
    expect(
      screen.getByText("Approve this Plugin's permissions to turn it on.")
    ).toBeInTheDocument();
    // Today's row hides the list without an approval record; only the trigger
    // and the explanation remain.
    expect(screen.queryByRole("checkbox", { name: /Read your Library/ })).toBeNull();
  });

  it("shows no issue for an approved copy with only optional permissions ungranted", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        manifest: manifest({
          permissions: { required: ["library:read"], optional: ["network:api.example.com"] },
        }),
        approval: approval({ granted: ["library:read"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.queryByText("Needs attention")).toBeNull();

    await openPermissions(user);
    expect(screen.queryByRole("button", { name: "Review" })).toBeNull();
  });

  it("orders the panel: description, settings rows, permissions, details, footer", async () => {
    const user = userEvent.setup();
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );
    seed(
      entry({
        manifest: manifest({
          description: "Find repeated passages.",
          permissions: { required: ["library:read"], optional: [] },
        }),
        approval: approval({ granted: ["library:read"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);

    const description = screen.getByText("Find repeated passages.");
    const settingsRow = document.querySelector('[data-settings-row="plugin.echoes.threshold"]');
    const permissions = screen.getByRole("button", { name: /Plugin permissions/ });
    const details = screen.getByText("Details");
    const remove = screen.getByRole("button", { name: "Remove" });

    const precedes = (first: Node | null, second: Node | null) =>
      first !== null &&
      second !== null &&
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(precedes(description, settingsRow)).toBe(true);
    expect(precedes(settingsRow, permissions)).toBe(true);
    expect(precedes(permissions, details)).toBe(true);
    expect(precedes(details, remove)).toBe(true);
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

    expect(screen.getByRole("button", { name: /^Alpha/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Beta/ })).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Filter by status" });
    await tabTo(user, trigger, 20);
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await focusFilterOption(user, screen.getByRole("option", { name: /Installed/ }));
    await user.keyboard(" ");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Alpha/ })).toBeNull());
    // Beta stays: ANY semantics, and it still matches Built-in / Available.
    expect(screen.getByRole("button", { name: /^Beta/ })).toBeInTheDocument();
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
    expect(screen.getByText("Echoes stopped unexpectedly.")).toBeInTheDocument();

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
    expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeDisabled();
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
    expect(screen.getByRole("switch", { name: "Enable Echoes" })).toBeDisabled();
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

  it("disables Add Plugin on Android and explains why (#447)", async () => {
    platformState.kind = "android";
    render(<PluginsSection />);

    // The action stays visible but disabled, like the row's enable control, so
    // the section explains itself instead of offering a Plugin that cannot run.
    const addButton = screen.getByRole("button", { name: "Add Plugin" });
    expect(addButton).toBeDisabled();
    expect(
      screen.getByText(
        "Plugins are not available on Android in this version. Maibuk does not run Plugins here yet, so there is nothing to add or change."
      )
    ).toBeInTheDocument();
    // The disabled action is tied to that explanation, so a screen reader hears
    // why it is off, not just that it is.
    expect(addButton).toHaveAccessibleDescription(
      "Plugins are not available on Android in this version. Maibuk does not run Plugins here yet, so there is nothing to add or change."
    );

    // Its Command is not bound either, so the keyboard cannot reach it.
    await waitFor(() =>
      expect(useBoundShortcutStore.getState().counts["settings.addPlugin"]).toBeUndefined()
    );
  });

  it("shows each Stopped reason's own copy", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        pluginId: "alpha",
        manifest: manifest({ id: "alpha", name: "Alpha" }),
        approval: approval({ enabled: true }),
        review: review({ status: "approved" }),
        stopped: { reason: "unresponsive" },
      }),
      entry({
        pluginId: "beta",
        manifest: manifest({ id: "beta", name: "Beta" }),
        approval: approval({ enabled: true }),
        review: review({ status: "approved" }),
        stopped: { reason: "out-of-memory" },
      })
    );
    render(<PluginsSection />);

    await openRow(user, "Alpha");
    expect(screen.getByText("Alpha stopped responding and was closed.")).toBeInTheDocument();
    await openRow(user, "Beta");
    expect(screen.getByText("Beta used too much memory and was stopped.")).toBeInTheDocument();
  });

  it("shows the Plugin's data size when expanded", async () => {
    const user = userEvent.setup();
    seed(entry());
    usePluginManagementStore.setState({ dataSizes: { echoes: 4 * 1024 * 1024 } });
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.getByText("4 MB")).toBeInTheDocument();
  });

  it("shows the custom-UI disclosure only for a Plugin that declares one", async () => {
    const user = userEvent.setup();
    seed(entry({ manifest: manifest({ customUi: true }) }));
    render(<PluginsSection />);

    await openRow(user);
    expect(
      screen.getByText("Custom UI: accessibility not verified by Maibuk")
    ).toBeInTheDocument();
  });

  it("hides the custom-UI disclosure for a Plugin with none", async () => {
    const user = userEvent.setup();
    seed(entry({ manifest: manifest({ customUi: false }) }));
    render(<PluginsSection />);

    await openRow(user);
    expect(
      screen.queryByText("Custom UI: accessibility not verified by Maibuk")
    ).toBeNull();
  });

  it("removes a third-party Plugin, warning it cannot be recovered, and deletes its data", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    const remove = vi.fn(async () => {});
    usePluginManagementStore.setState({ remove });
    render(<PluginsSection />);

    await openRow(user);
    const removeButton = screen.getByRole("button", { name: "Remove" });
    await tabTo(user, removeButton);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog", { name: "Remove Echoes?" });
    expect(
      within(dialog).getByText(
        "Maibuk cannot recover this third-party Plugin. To use it again, you must manually add its files."
      )
    ).toBeInTheDocument();

    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Also delete this Plugin’s data",
    });
    expect(checkbox).not.toBeChecked();
    await tabTo(user, checkbox);
    await user.keyboard(" ");
    expect(checkbox).toBeChecked();

    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    expect(remove).toHaveBeenCalledWith("echoes", { deleteData: true });
  });

  it("removes a Built-in without the third-party warning or data deletion", async () => {
    const user = userEvent.setup();
    seed(
      entry({
        builtIn: true,
        approval: approval({ enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    const remove = vi.fn(async () => {});
    usePluginManagementStore.setState({ remove });
    render(<PluginsSection />);

    await openRow(user);
    const removeButton = screen.getByRole("button", { name: "Remove" });
    await tabTo(user, removeButton);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog", { name: "Remove Echoes?" });
    expect(within(dialog).queryByText(/cannot recover this third-party Plugin/)).toBeNull();

    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    expect(remove).toHaveBeenCalledWith("echoes", { deleteData: false });
  });

  it("cancels removal with Escape and returns focus to the Remove button", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    const remove = vi.fn(async () => {});
    usePluginManagementStore.setState({ remove });
    render(<PluginsSection />);

    await openRow(user);
    const removeButton = screen.getByRole("button", { name: "Remove" });
    await tabTo(user, removeButton);
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(removeButton));
  });

  it("deletes a removed row's retained data by keyboard and keeps the row", async () => {
    const user = userEvent.setup();
    seed(entry({ installed: false, removed: true }));
    const deleteData = vi.fn(async () => {});
    usePluginManagementStore.setState({ deleteData, dataSizes: { echoes: 4096 } });
    render(<PluginsSection />);

    await openRow(user);
    const deleteButton = screen.getByRole("button", { name: "Delete data" });
    await tabTo(user, deleteButton);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Delete this Plugin’s retained Library data? This cannot be undone here. The Plugin row and Command preferences stay."
      )
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Delete data" });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    expect(deleteData).toHaveBeenCalledWith("echoes");
    expect(screen.getByRole("button", { name: /^Echoes/ })).toBeInTheDocument();
  });

  it("reinstalls a removed Built-in after confirming in the dialog", async () => {
    const user = userEvent.setup();
    seed(entry({ builtIn: true, installed: false, removed: true, available: true }));
    const reinstallBuiltIn = vi.fn(async () => true);
    usePluginManagementStore.setState({ reinstallBuiltIn });
    render(<PluginsSection />);

    await openRow(user);
    const reinstall = screen.getByRole("button", { name: "Reinstall" });
    await tabTo(user, reinstall, 20);
    await user.keyboard("{Enter}");

    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText(
        "Install the bundled copy again. Retained Library data reconnects; revoked access is not silently restored."
      )
    ).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Reinstall" });
    await tabTo(user, confirm);
    await user.keyboard("{Enter}");

    expect(reinstallBuiltIn).toHaveBeenCalledWith("echoes");
  });

  it("cancels Reinstall with Escape without reinstalling", async () => {
    const user = userEvent.setup();
    seed(entry({ builtIn: true, installed: false, removed: true, available: true }));
    const reinstallBuiltIn = vi.fn(async () => true);
    usePluginManagementStore.setState({ reinstallBuiltIn });
    render(<PluginsSection />);

    await openRow(user);
    const reinstall = screen.getByRole("button", { name: "Reinstall" });
    await tabTo(user, reinstall, 20);
    await user.keyboard("{Enter}");
    await screen.findByRole("alertdialog");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(reinstallBuiltIn).not.toHaveBeenCalled();
  });

  it("offers no Reinstall for a removed third-party Plugin", async () => {
    const user = userEvent.setup();
    seed(entry({ installed: false, removed: true }));
    render(<PluginsSection />);

    await openRow(user);
    expect(screen.queryByRole("button", { name: "Reinstall" })).toBeNull();
  });

  it("shows the Removed badge and no status badge on a removed row", () => {
    seed(entry({ installed: false, removed: true }));
    render(<PluginsSection />);

    expect(screen.getByText("Removed")).toBeInTheDocument();
    // A row whose files are gone has no enable state to report and no switch.
    expect(screen.queryByText("Off")).toBeNull();
    expect(screen.queryByText("Enabled")).toBeNull();
    expect(screen.queryByRole("switch", { name: /Enable / })).toBeNull();
  });

  it("shows the expanded-row facts for an installed approved copy", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(secretStore({ listNames: async () => ["token"] }));
    seed(
      entry({
        approval: approval({ granted: ["secrets"], enabled: true }),
        review: review({ status: "approved" }),
      })
    );
    render(<PluginsSection />);

    await openRow(user);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByText("Saved credentials")).toBeInTheDocument();
    expect(screen.getByText("Approved copy")).toBeInTheDocument();
    expect(screen.getByText("Custom Shortcuts and Voice Commands")).toBeInTheDocument();
    expect(screen.getByText("Retained")).toBeInTheDocument();
    // Files, saved credentials (read from the store), and the approved copy.
    await waitFor(() => expect(screen.getAllByText("Present")).toHaveLength(3));
  });

  it("shows the absent facts and the manual-recovery line for a removed third-party row", async () => {
    const user = userEvent.setup();
    seed(entry({ installed: false, removed: true }));
    render(<PluginsSection />);

    await openRow(user);

    expect(screen.getByText("Absent")).toBeInTheDocument();
    // Saved credentials and the approved copy are both gone after removal.
    expect(screen.getAllByText("None")).toHaveLength(2);
    expect(screen.getByText("Retained")).toBeInTheDocument();
    expect(
      screen.getByText("Manually add the Plugin again to use it.")
    ).toBeInTheDocument();
  });

  it("shows the 50 MB size warning inline in the expanded row", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    usePluginManagementStore.setState({
      dataSizes: { echoes: PLUGIN_DATA_SIZE_WARNING_BYTES },
    });
    render(<PluginsSection />);

    await openRow(user);

    expect(
      screen.getByText(
        "Plugin data exceeds 50 MB. Large data can slow Library saving on web and enlarge Backups."
      )
    ).toBeInTheDocument();
  });

  it("binds each per-Plugin Command to its first eligible row", async () => {
    seed(
      entry({
        pluginId: "alpha",
        manifest: manifest({ id: "alpha", name: "Alpha" }),
        approval: approval({ enabled: true }),
        review: review({ status: "approved" }),
      }),
      entry({
        pluginId: "beta",
        manifest: manifest({ id: "beta", name: "Beta" }),
        builtIn: true,
        installed: false,
        removed: true,
        available: true,
      }),
      entry({
        pluginId: "gamma",
        manifest: manifest({ id: "gamma", name: "Gamma" }),
        installed: false,
        removed: true,
        stopped: { reason: "crashed" },
      })
    );
    usePluginManagementStore.setState({ dataSizes: { gamma: 4096 } });
    render(<PluginsSection />);

    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["settings.removePlugin"]
      ).toBeGreaterThan(0)
    );
    expect(
      useBoundShortcutStore.getState().counts["settings.reinstallBuiltIn"]
    ).toBeGreaterThan(0);
    expect(
      useBoundShortcutStore.getState().counts["settings.deletePluginData"]
    ).toBeGreaterThan(0);
    expect(
      useBoundShortcutStore.getState().counts["settings.restartPlugin"]
    ).toBeGreaterThan(0);
    expect(
      useBoundShortcutStore.getState().counts["settings.togglePlugin"]
    ).toBeGreaterThan(0);
  });

  it("opens the Remove dialog when its Command runs", async () => {
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    const remove = vi.fn(async () => {});
    usePluginManagementStore.setState({ remove });
    render(<PluginsSection />);

    await waitFor(() =>
      expect(
        useBoundShortcutStore.getState().counts["settings.removePlugin"]
      ).toBeGreaterThan(0)
    );
    await expect(runCommand("settings.removePlugin", { source: "palette" })).resolves.toBe("ran");
    expect(await screen.findByRole("alertdialog", { name: "Remove Echoes?" })).toBeInTheDocument();
  });

  it("toggles the data-deletion checkbox by clicking its visible text", async () => {
    const user = userEvent.setup();
    seed(entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) }));
    usePluginManagementStore.setState({ remove: vi.fn(async () => {}) });
    render(<PluginsSection />);

    await openRow(user);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove Echoes?" });
    const checkbox = within(dialog).getByRole("checkbox", {
      name: "Also delete this Plugin’s data",
    });
    expect(checkbox).not.toBeChecked();

    await user.click(within(dialog).getByText("Also delete this Plugin’s data"));

    expect(checkbox).toBeChecked();
  });
});

describe("Plugin credential storage on web (#453 unit 5)", () => {
  const REMEMBER = "Remember credentials on this device";

  /** The value beside one expanded-row fact, read by its label. */
  function factValue(label: string): string {
    const dt = screen.getByText(label);
    return dt.nextElementSibling?.textContent ?? "";
  }

  /** An approved entry whose manifest declares the secrets permission. */
  function secretsEntry(): PluginManagementEntry {
    return entry({
      manifest: manifest({ permissions: { required: [], optional: ["secrets"] } }),
      approval: approval({ granted: ["secrets"], enabled: true }),
      review: review({ status: "approved" }),
    });
  }

  it("offers the switch and turns remembering on by keyboard", async () => {
    const user = userEvent.setup();
    const setRemembered = vi.fn(async () => {});
    registerPluginSecretStore(
      secretStore({ isRemembered: () => false, setRemembered })
    );
    seed(secretsEntry());
    render(<PluginsSection />);

    await openRow(user);
    await openPermissions(user);
    const toggle = await screen.findByRole("switch", { name: REMEMBER });
    expect(toggle).not.toBeChecked();

    await tabTo(user, toggle, 60);
    await user.keyboard(" ");

    expect(setRemembered).toHaveBeenCalledWith("echoes", true);
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it("reflects a Plugin already remembered on this device", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(
      secretStore({ isRemembered: () => true, setRemembered: async () => {} })
    );
    seed(secretsEntry());
    render(<PluginsSection />);

    await openRow(user);
    await openPermissions(user);

    expect(await screen.findByRole("switch", { name: REMEMBER })).toBeChecked();
  });

  it("hides the switch when the registered store cannot remember", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(secretStore());
    seed(secretsEntry());
    render(<PluginsSection />);

    await openRow(user);

    expect(screen.queryByRole("switch", { name: REMEMBER })).toBeNull();
    expect(screen.queryByText(REMEMBER)).toBeNull();
  });

  it("hides the switch when the Plugin does not declare secrets", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(
      secretStore({ isRemembered: () => false, setRemembered: async () => {} })
    );
    seed(
      entry({ approval: approval({ enabled: true }), review: review({ status: "approved" }) })
    );
    render(<PluginsSection />);

    await openRow(user);

    expect(screen.queryByRole("switch", { name: REMEMBER })).toBeNull();
  });

  it("shows saved credentials only when the store holds a value", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(secretStore({ listNames: async () => [] }));
    seed(secretsEntry());
    render(<PluginsSection />);

    await openRow(user);

    await waitFor(() => expect(factValue("Saved credentials")).toBe("None"));
  });

  it("shows the saved credential a store reports", async () => {
    const user = userEvent.setup();
    registerPluginSecretStore(secretStore({ listNames: async () => ["token"] }));
    seed(secretsEntry());
    render(<PluginsSection />);

    await openRow(user);

    await waitFor(() => expect(factValue("Saved credentials")).toBe("Present"));
  });
});

/**
 * Installs a fake lifecycle whose one Plugin is ready, so the Settings section
 * mounts the Plugin's Remote UI body the way the app does when it is running.
 */
function installReadyLifecycle(pluginId: string, runtime: PluginRuntime): void {
  const ready = { status: "ready", startReason: "enable" } as const;
  const lifecycle = {
    launch: async () => {},
    installed: () => [],
    launchScanned: () => true,
    onLaunchScanned: () => () => {},
    surfaceReached: () => {},
    surfaceLeft: () => {},
    start: async () => ({ ok: true, startReason: "enable" }),
    install: async () => ({ ok: true, startReason: "enable" }),
    uninstall: () => {},
    stop: () => {},
    state: (id: string) => (id === pluginId ? ready : null),
    runtime: (id: string) => (id === pluginId ? runtime : null),
    subscribe: () => () => {},
    dispose: () => {},
  } as unknown as PluginLifecycle;
  setPluginLifecycleInstance(lifecycle);
}

describe("Plugin Settings row body (#450)", () => {
  let host: ReturnType<typeof createTestHost> | null = null;

  afterEach(() => {
    host?.stop();
    host = null;
    resetPluginLifecycleForTests();
  });

  it("mounts the Plugin's controls in Settings and reaches them by keyboard", async () => {
    const user = userEvent.setup();
    unregisters.push(
      registerPluginSettingsRows("echoes", {
        displayName: "Echoes",
        rows: [{ id: "threshold", label: "Echo threshold" }],
      })
    );
    seed(entry());

    host = createTestHost({ manifest: manifest() });

    /** The Settings row body the Plugin serves under the row's Plugin-local id. */
    function ThresholdBody() {
      const [on, setOn] = useState(false);
      return (
        <ui.Switch
          label="Echo threshold"
          isSelected={on}
          onChange={(event: { detail: boolean }) => setOn(event.detail)}
        />
      );
    }
    servePluginUi(createPluginClient(host.port), {
      pages: {},
      settingsRows: { threshold: ThresholdBody },
    });

    installReadyLifecycle("echoes", {
      manifest: manifest(),
      broker: host.broker,
      files: [],
      sendFrame: () => {},
      stop: () => {},
    });

    render(<PluginsSection />);
    await openRow(user);

    const control = await screen.findByRole("switch", { name: "Echo threshold" });
    // The Plugin's body (holding the control) is a sibling after the stacked
    // row's label block, so it takes the full width below the label.
    const row = control.closest<HTMLElement>('[data-settings-row="plugin.echoes.threshold"]');
    expect(row).toHaveClass("flex-col");
    expect(row).not.toHaveClass("@lg:flex-row");
    expect(row!.firstElementChild).not.toContainElement(control);
    expect(row!.firstElementChild?.nextElementSibling).toContainElement(control);
    await tabTo(user, control, 40);
    await user.keyboard(" ");
    expect(control).toBeChecked();
  });
});
