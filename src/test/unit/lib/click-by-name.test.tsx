import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button as AriaButton } from "react-aria-components";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemActionsMenu } from "@/components/ui/ItemActionsMenu";
import { Modal } from "@/components/ui/Modal";
import { useModalStore } from "@/components/ui/modal-store";
import { ClickBadges } from "@/components/dictation/ClickBadges";
import {
  clearChoices,
  collectPressable,
  findByName,
  pressByName,
  pressChoice,
  pressControl,
  useClickChoicesStore,
} from "@/lib/click-by-name";
import "@/i18n";

beforeEach(() => {
  useModalStore.setState({ modalIds: [], openCount: 0, closers: {} });
  useClickChoicesStore.setState({ choices: [] });
});

function BasicHarness({ onExport }: { onExport: () => void }) {
  return (
    <>
      <button type="button" onClick={onExport}>
        Export
      </button>
      <button type="button">Save as template</button>
    </>
  );
}

function ModalHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Page action
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Settings">
        <button type="button">Dialog action</button>
      </Modal>
    </>
  );
}

function MenuHarness() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button type="button">Page button</button>
      <ItemActionsMenu
        label="Item actions"
        actions={[
          { id: "one", label: "First action", onAction: () => {} },
          { id: "two", label: "Second action", onAction: () => {} },
        ]}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
      />
    </>
  );
}

describe("collectPressable and findByName", () => {
  it("confines to the dialog when a Modal is open", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    await user.click(screen.getByRole("button", { name: "Page action" }));
    await screen.findByRole("dialog");
    // Only the dialog's control matches; the page behind does not.
    expect(findByName("Dialog action").map((el) => el.textContent)).toEqual(["Dialog action"]);
    expect(findByName("Page action")).toEqual([]);
  });

  it("finds open menu items by name", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole("button", { name: "Item actions" }));
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "Second action" })).toBeInTheDocument()
    );
    // The menu item matches; a page control with another name never matches it.
    expect(findByName("Second action").map((el) => el.textContent)).toContain("Second action");
    expect(findByName("Second action").some((el) => el.textContent === "Page button")).toBe(false);
  });

  it("ignores disabled controls", () => {
    render(
      <>
        <button type="button" disabled>
          Export
        </button>
        <button type="button" aria-disabled="true">
          Save
        </button>
      </>
    );
    expect(findByName("Export")).toEqual([]);
    expect(collectPressable().filter((el) => el.textContent === "Save")).toEqual([]);
  });

  it("ignores an inert subtree", () => {
    render(
      <>
        <div inert={true}>
          <button type="button">Buried</button>
        </div>
        <button type="button">Shown</button>
      </>
    );
    expect(findByName("Buried")).toEqual([]);
    expect(findByName("Shown")).toHaveLength(1);
  });

  it("matches whole names, folding case and punctuation", () => {
    render(<BasicHarness onExport={() => {}} />);
    expect(findByName("Save")).toEqual([]);
    expect(findByName("export!")).toHaveLength(1);
    expect(findByName("EXPORT")).toHaveLength(1);
  });
});

describe("pressByName and pressChoice", () => {
  it("lists duplicate names as choices with badges, then presses the second", async () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <>
        <button type="button" onClick={first}>
          Duplicate
        </button>
        <button type="button" onClick={second}>
          Duplicate
        </button>
        <ClickBadges />
      </>
    );
    const result = pressByName("duplicate");
    expect(result).toEqual({ kind: "choices", count: 2 });
    // Badges render the 1-based numbers.
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    const pressed = pressChoice(2);
    expect(pressed.kind).toBe("pressed");
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // Badges disappear once a choice is pressed.
    await waitFor(() => expect(screen.queryByText("1")).not.toBeInTheDocument());
    expect(useClickChoicesStore.getState().choices).toEqual([]);
    clearChoices();
  });

  it("toggles a checkbox with Space activation", async () => {
    const onChange = vi.fn();
    render(
      <label>
        <input type="checkbox" onChange={(event) => onChange(event.target.checked)} />
        Agree
      </label>
    );
    const box = screen.getByRole("checkbox", { name: "Agree" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    pressControl(box);
    expect(box.checked).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("runs a React Aria Button onPress once", () => {
    const onPress = vi.fn();
    render(<AriaButton onPress={onPress}>Aria action</AriaButton>);
    const pressed = pressByName("aria action");
    expect(pressed.kind).toBe("pressed");
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("Click by Name during a Tutorial run", () => {
  it("only returns controls inside the Tutorial card", () => {
    render(
      <>
        <div inert={true}>
          <button type="button">Author action</button>
        </div>
        <div aria-modal="true" role="dialog" aria-label="Tutorial">
          <button type="button">Tutorial action</button>
        </div>
      </>
    );
    // The runner marks the app inert; the topmost layer is the Tutorial card.
    expect(findByName("Author action")).toEqual([]);
    expect(findByName("Tutorial action")).toHaveLength(1);
  });
});
