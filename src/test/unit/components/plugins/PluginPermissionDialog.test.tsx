/**
 * The Plugin permission approval dialog (#442). These prove the behavior the
 * prototype accepted: required Plugin Permissions are checked and locked,
 * optional ones are toggled on by default and can be turned off, approving is
 * a keyboard action, Escape closes and returns focus to the trigger, and the
 * copy is shown in both languages.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import "@/i18n";
import { PluginPermissionDialog } from "@/components/plugins/PluginPermissionDialog";
import type { PluginManifest, PluginPermissionId } from "@/features/plugins/types";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

type User = ReturnType<typeof userEvent.setup>;

const manifest: PluginManifest = {
  ...PLUGIN_MANIFEST,
  id: "echoes",
  name: "Echoes",
  permissions: { required: ["library:read"], optional: ["network:api.example.com"] },
};

function Harness({
  copy = manifest,
  onApprove,
}: {
  copy?: PluginManifest;
  onApprove: (optionalGranted: PluginPermissionId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Review and enable
      </button>
      <PluginPermissionDialog
        isOpen={open}
        manifest={copy}
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

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("PluginPermissionDialog", () => {
  it("shows every permission in plain language, required checked and locked", async () => {
    const user = userEvent.setup();
    render(<Harness onApprove={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");

    const required = screen.getByRole("checkbox", {
      name: "Read your Library · Required to enable this Plugin",
    });
    expect(required).toBeChecked();
    expect(required).toBeDisabled();
    expect(
      screen.getByText(/Read Books, Chapters and Notes, plus Canvas names and details\./)
    ).toBeInTheDocument();

    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    expect(optional).toBeChecked();
    expect(optional).not.toBeDisabled();

    expect(screen.getByText(/You are responsible for what you install/)).toBeInTheDocument();
  });

  it("never toggles a required permission, while an optional one toggles by keyboard", async () => {
    const user = userEvent.setup();
    render(<Harness onApprove={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");

    const required = screen.getByRole("checkbox", {
      name: "Read your Library · Required to enable this Plugin",
    });
    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });

    // The locked required box is not in the tab order: tabbing reaches the
    // optional one without ever focusing the required one.
    const reached: Element[] = [];
    for (let i = 0; i < 6 && document.activeElement !== optional; i++) {
      await user.tab();
      if (document.activeElement) reached.push(document.activeElement);
    }
    expect(optional).toHaveFocus();
    expect(reached).not.toContain(required);

    await user.keyboard(" ");
    expect(optional).not.toBeChecked();
    expect(required).toBeChecked();

    await user.keyboard(" ");
    expect(optional).toBeChecked();
    expect(required).toBeChecked();
  });

  it("approves with the optional grants chosen by keyboard", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<Harness onApprove={onApprove} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");

    const approve = screen.getByRole("button", { name: "Approve this copy and enable" });
    await tabTo(user, approve);
    await user.keyboard("{Enter}");

    expect(onApprove).toHaveBeenCalledWith(["network:api.example.com"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("approves with an optional permission left off", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<Harness onApprove={onApprove} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");

    const optional = screen.getByRole("checkbox", {
      name: "Connect to api.example.com · Optional",
    });
    await tabTo(user, optional);
    await user.keyboard(" ");
    const approve = screen.getByRole("button", { name: "Approve this copy and enable" });
    await tabTo(user, approve);
    await user.keyboard("{Enter}");

    expect(onApprove).toHaveBeenCalledWith([]);
  });

  it("shows the custom-UI notice when the manifest declares one", async () => {
    const user = userEvent.setup();
    render(
      <Harness copy={{ ...manifest, customUi: true }} onApprove={vi.fn()} />
    );
    await tabTo(user, screen.getByRole("button", { name: "Review and enable" }));
    await user.keyboard("{Enter}");
    expect(
      screen.getByText(/Custom UI: accessibility not verified by Maibuk/)
    ).toBeInTheDocument();
  });

  it("shows the process permission in plain language", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        copy={{ ...manifest, permissions: { required: ["process"], optional: [] } }}
        onApprove={vi.fn()}
      />
    );
    await tabTo(user, screen.getByRole("button", { name: "Review and enable" }));
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Run programs on your computer/)).toBeInTheDocument();
    expect(screen.getByText(/Desktop only. The exact Terminal API/)).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness onApprove={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Review and enable" });
    await tabTo(user, trigger);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows the Spanish copy", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    render(<Harness onApprove={vi.fn()} />);
    await tabTo(user, screen.getByRole("button", { name: "Review and enable" }));
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("checkbox", {
        name: "Leer tu Biblioteca · Obligatorio para activar este Plugin",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar esta copia y activar" })).toBeInTheDocument();
  });
});
