import { useRef, useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStore } from "@/components/ui/modal-store";
import { ItemActionsMenu, type ItemAction } from "@/components/ui/ItemActionsMenu";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { useItemCommands } from "@/hooks/useItemCommands";
import { useBoundShortcuts } from "@/lib/bound-shortcuts";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

function Item({ name, actions }: { name: string; actions: ItemAction[] }) {
  const ref = useRef<HTMLFieldSetElement>(null);
  const [open, setOpen] = useState(false);
  useItemCommands(ref, actions);
  return (
    <fieldset ref={ref} aria-label={name}>
      <button type="button">{name}</button>
      <ItemActionsMenu
        label={`Actions for ${name}`}
        actions={actions}
        isOpen={open}
        onOpenChange={setOpen}
      />
    </fieldset>
  );
}

function BoundList() {
  return <output aria-label="bound">{useBoundShortcuts().join(",")}</output>;
}

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

describe("useItemCommands", () => {
  it("runs the action of the item that has focus, and only that one", async () => {
    const user = userEvent.setup();
    const deleteA = vi.fn();
    const deleteB = vi.fn();
    render(
      <>
        <button type="button">outside</button>
        <Item
          name="A"
          actions={[
            { id: "delete", label: "Delete", commandId: "common.delete", onAction: deleteA },
          ]}
        />
        <Item
          name="B"
          actions={[
            { id: "delete", label: "Delete", commandId: "common.delete", onAction: deleteB },
          ]}
        />
      </>
    );

    await user.tab();
    await user.keyboard("{Delete}");
    expect(deleteA).not.toHaveBeenCalled();
    expect(deleteB).not.toHaveBeenCalled();

    await user.tab();
    await user.keyboard("{Delete}");
    expect(deleteA).toHaveBeenCalledTimes(1);

    await user.tab();
    await user.tab();
    await user.keyboard("{Delete}");
    expect(deleteB).toHaveBeenCalledTimes(1);
    expect(deleteA).toHaveBeenCalledTimes(1);
  });

  it("lists the item's Commands as bound only while it has focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">outside</button>
        <Item
          name="A"
          actions={[
            { id: "delete", label: "Delete", commandId: "common.delete", onAction: () => {} },
          ]}
        />
        <BoundList />
      </>
    );

    await user.tab();
    expect(screen.getByRole("status", { name: "bound" })).toHaveTextContent("");
    await user.tab();
    expect(screen.getByRole("status", { name: "bound" })).toHaveTextContent("common.delete");
  });

  it("skips a disabled action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <Item
        name="A"
        actions={[
          { id: "delete", label: "Delete", commandId: "common.delete", isDisabled: true, onAction },
        ]}
      />
    );

    await user.tab();
    await user.keyboard("{Delete}");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("follows a Custom Shortcut", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    useShortcutSettingsStore.setState({
      shortcuts: {
        version: 2,
        voice: {},
        custom: { "common.delete": [["Mod+Shift+x"]] },
        singleKeyEnabled: true,
      },
    });
    render(
      <Item
        name="A"
        actions={[{ id: "delete", label: "Delete", commandId: "common.delete", onAction }]}
      />
    );

    await user.tab();
    await user.keyboard("{Delete}");
    expect(onAction).not.toHaveBeenCalled();
    await user.keyboard("{Control>}{Shift>}X{/Shift}{/Control}");
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe("Item Menu shows each action's Shortcut", () => {
  it("renders the first live key beside an action with a Command, and none for one without", async () => {
    const user = userEvent.setup();
    render(
      <Item
        name="A"
        actions={[
          { id: "delete", label: "Delete", commandId: "common.delete", onAction: () => {} },
          { id: "rename", label: "Rename", onAction: () => {} },
        ]}
      />
    );

    await user.tab();
    await user.tab();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    const deleteItem = within(menu).getByRole("menuitem", { name: /Delete/ });
    expect(deleteItem.querySelector("kbd")).toHaveTextContent("Delete");
    expect(within(menu).getByRole("menuitem", { name: "Rename" }).querySelector("kbd")).toBeNull();
  });
});
