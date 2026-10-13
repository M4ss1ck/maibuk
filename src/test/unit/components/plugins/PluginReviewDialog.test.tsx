/**
 * The changed-files review dialog (#442). These prove the behavior the plan
 * accepts: the per-file diff (Added / Changed / Removed) and the permission
 * diff (Added / Removed / Now required) are shown, a permission that is now
 * required is checked and locked, an "Older version" copy says so, a
 * permission-only review says `noChanges`, and approving by keyboard hands the
 * chosen optional grants to the store's `markReviewed`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { PluginReviewDialog } from "@/components/plugins/PluginReviewDialog";
import type {
  PluginManagementEntry,
  PluginManifest,
  PluginPermissionDiff,
  PluginPermissionId,
  PluginReview,
} from "@/features/plugins/types";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

type User = ReturnType<typeof userEvent.setup>;

const manifest: PluginManifest = {
  ...PLUGIN_MANIFEST,
  id: "echoes",
  name: "Echoes",
  version: "1.3.0",
  permissions: {
    required: ["library:read", "editor:write"],
    optional: ["network:api.example.com"],
  },
};

function emptyDiff(): PluginPermissionDiff {
  return { added: [], removed: [], nowRequired: [], nowOptional: [] };
}

function review(overrides: Partial<PluginReview> = {}): PluginReview {
  return {
    status: "review-required",
    files: { added: [], removed: [], changed: [] },
    permissions: emptyDiff(),
    olderVersion: false,
    ...overrides,
  };
}

function entry(overrides: Partial<PluginManagementEntry> = {}): PluginManagementEntry {
  return {
    pluginId: "echoes",
    manifest,
    approval: {
      pluginId: "echoes",
      pinnedHash: "h1:x",
      granted: [],
      enabled: false,
      approvedVersion: "1.0.0",
      approvedPermissions: { required: [], optional: [] },
      approvedFiles: {},
    },
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

function Harness({
  copy,
  onApprove,
}: {
  copy: PluginManagementEntry;
  onApprove: (optionalGranted: PluginPermissionId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Review and enable
      </button>
      <PluginReviewDialog
        isOpen={open}
        entry={copy}
        onClose={() => setOpen(false)}
        onApprove={(optionalGranted) => {
          onApprove(optionalGranted);
          setOpen(false);
        }}
      />
    </>
  );
}

/** Tabs until `target` has focus, then asserts it (the dialog traps focus). */
async function tabTo(user: User, target: HTMLElement, max = 12): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (document.activeElement === target) return;
    await user.tab();
  }
  expect(document.activeElement).toBe(target);
}

async function openDialog(user: User): Promise<void> {
  await tabTo(user, screen.getByRole("button", { name: "Review and enable" }));
  await user.keyboard("{Enter}");
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("PluginReviewDialog", () => {
  it("shows the per-file diff by Added, Changed, and Removed", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        copy={entry({
          review: review({
            files: { added: ["fresh.js"], removed: ["gone.js"], changed: ["index.js"] },
          }),
        })}
        onApprove={vi.fn()}
      />
    );
    await openDialog(user);

    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("fresh.js")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("index.js")).toBeInTheDocument();
    expect(screen.getAllByText("Removed").length).toBeGreaterThan(0);
    expect(screen.getByText("gone.js")).toBeInTheDocument();
  });

  it("shows a Now required permission checked and locked", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        copy={entry({
          review: review({
            permissions: {
              ...emptyDiff(),
              nowRequired: [{ permission: "editor:write", required: true }],
            },
          }),
        })}
        onApprove={vi.fn()}
      />
    );
    await openDialog(user);

    expect(screen.getByText(/Now required/)).toBeInTheDocument();
    const nowRequired = screen.getByRole("checkbox", {
      name: /Change the focused editor · Required to enable this Plugin · Now required/,
    });
    expect(nowRequired).toBeChecked();
    expect(nowRequired).toBeDisabled();
  });

  it("shows the Older version label", async () => {
    const user = userEvent.setup();
    render(<Harness copy={entry({ review: review({ olderVersion: true }) })} onApprove={vi.fn()} />);
    await openDialog(user);
    expect(screen.getByText("Older version")).toBeInTheDocument();
  });

  it("shows noChanges when the permissions did not change", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        copy={entry({ review: review({ files: { added: ["fresh.js"], removed: [], changed: [] } }) })}
        onApprove={vi.fn()}
      />
    );
    await openDialog(user);
    expect(
      screen.getByText(
        "No permission changes. The files still changed, so this copy needs your approval."
      )
    ).toBeInTheDocument();
  });

  it("approves by keyboard with the optional grants chosen", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<Harness copy={entry()} onApprove={onApprove} />);
    await openDialog(user);

    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    await tabTo(user, optional);
    await user.keyboard(" ");
    const approve = screen.getByRole("button", { name: "Approve this copy and enable" });
    await tabTo(user, approve);
    await user.keyboard("{Enter}");

    expect(onApprove).toHaveBeenCalledWith([]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness copy={entry()} onApprove={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await openDialog(user);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the Spanish copy", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    render(<Harness copy={entry({ review: review({ olderVersion: true }) })} onApprove={vi.fn()} />);
    await openDialog(user);
    expect(screen.getByText("Versión anterior")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar esta copia y activar" })).toBeInTheDocument();
  });
});
