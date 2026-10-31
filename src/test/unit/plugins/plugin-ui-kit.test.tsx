// The Remote UI kit, part 2 (#439): organization, overlays, feedback, and
// Plugin CSS, driven through the real remote renderer. Every test mounts the
// Plugin's SDK tree, drives the host with `user-event`, and asserts the Plugin's
// handlers fired and the host's own state changed. Interactive rows carry a
// `@ui-kbd:<tag>` title; non-interactive rows carry `@ui:<tag>`.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { installPointerEvent } from "@/test/support/pointer-events";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

beforeAll(installPointerEvent);

let harness: RemoteUiHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

/** Tabs the focus forward until a button with this text holds it. */
async function tabToButton(text: string, max = 8): Promise<HTMLElement> {
  for (let i = 0; i < max; i += 1) {
    await userEvent.tab();
    const active = document.activeElement as HTMLElement | null;
    if (active?.textContent?.trim() === text) return active;
  }
  throw new Error(`never reached the ${text} button by keyboard`);
}

describe("the Remote UI kit, part 2", () => {
  describe("organization", () => {
    it("switches tabs and their panel with the arrow keys @ui-kbd:maibuk-tabs", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [key, setKey] = useState("a");
        return (
          <ui.Tabs
            label="Sections"
            items={[
              { value: "a", label: "Alpha" },
              { value: "b", label: "Beta" },
            ]}
            selectedKey={key}
            onChange={(event) => setKey(event.detail)}
          >
            <ui.Text>{`Panel ${key}`}</ui.Text>
          </ui.Tabs>
        );
      }
      await harness.mount(<Plugin />);
      expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel a");

      await userEvent.tab();
      await userEvent.keyboard("{ArrowRight}");

      expect(await screen.findByRole("tab", { name: "Beta" })).toHaveAttribute(
        "aria-selected",
        "true"
      );
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel b");
    });

    it("expands a disclosure from the keyboard @ui-kbd:maibuk-disclosure", async () => {
      harness = renderRemoteUi();
      const seen: boolean[] = [];
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <ui.Disclosure
            label="Details"
            isExpanded={open}
            onExpandedChange={(event) => {
              seen.push(event.detail);
              setOpen(event.detail);
            }}
          >
            <ui.Text>Hidden detail</ui.Text>
          </ui.Disclosure>
        );
      }
      await harness.mount(<Plugin />);
      expect(screen.getByText("Hidden detail")).not.toBeVisible();

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");

      expect(seen).toEqual([true]);
      expect(screen.getByText("Hidden detail")).toBeVisible();
    });

    it("selects a collection row with the keyboard @ui-kbd:maibuk-collection", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [keys, setKeys] = useState<readonly string[]>([]);
        return (
          <ui.Collection
            label="Chapters"
            selectionMode="single"
            selectedKeys={keys}
            onSelectionChange={(event) => setKeys([...event.detail])}
          >
            <ui.CollectionRow id="one" label="One" />
            <ui.CollectionRow id="two" label="Two" />
            <ui.CollectionRow id="three" label="Three" />
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      expect(document.activeElement).toHaveTextContent("Two");
      await userEvent.keyboard(" ");

      const selected = await screen.findByRole("option", { selected: true });
      expect(selected).toHaveTextContent("Two");
    });

    it("navigates a large list with the arrow keys @ui-kbd:maibuk-collection", async () => {
      harness = renderRemoteUi();
      const rows = Array.from({ length: 1000 }, (_, index) => `r${index}`);
      await harness.mount(
        <ui.Collection label="Many rows" selectionMode="none">
          {rows.map((id, index) => (
            <ui.CollectionRow key={id} id={id} label={`Row ${index}`} />
          ))}
        </ui.Collection>
      );

      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowDown}");
      expect(document.activeElement).toHaveAttribute("data-key", "r2");
    });

    it("expands a row and runs its Item Menu from the keyboard @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      const actions: string[] = [];
      function Plugin() {
        const [expanded, setExpanded] = useState(false);
        return (
          <ui.Collection label="Chapters" selectionMode="none">
            <ui.CollectionRow
              id="one"
              label="One"
              isExpandable
              isExpanded={expanded}
              onExpandedChange={(event) => setExpanded(event.detail)}
            >
              <ui.Text>Row one detail</ui.Text>
            </ui.CollectionRow>
            <ui.CollectionRow
              id="two"
              label="Two"
              menuItems={[
                { value: "rename", label: "Rename" },
                { value: "delete", label: "Delete" },
              ]}
              onMenuAction={(event) => actions.push(event.detail)}
            />
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);

      // The row is the control: Enter on it expands the panel.
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByText("Row one detail")).toBeInTheDocument();

      // A collection is one Tab stop, so the arrow moves between rows and the
      // row's Enter is the keyboard path to its Item Menu.
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");
      await screen.findByRole("menu");
      // The programmatic open focuses the menu itself; Down enters its items.
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      expect(actions).toEqual(["rename"]);
    });

    it("opens a row Item Menu from the ⋯ button (touch path) and runs an action", async () => {
      harness = renderRemoteUi();
      const actions: string[] = [];
      await harness.mount(
        <ui.Collection label="Chapters" selectionMode="none">
          <ui.CollectionRow
            id="two"
            label="Two"
            menuItems={[
              { value: "rename", label: "Rename" },
              { value: "delete", label: "Delete" },
            ]}
            onMenuAction={(event) => actions.push(event.detail)}
          />
        </ui.Collection>
      );

      // The ⋯ button is the pointer/touch path: the collection is one Tab stop,
      // so a touch user opens the menu from this control, not from the row.
      const more = screen.getByRole("button", { name: "More actions for Two" });
      // A comfortable coarse-pointer target, matching the repo convention.
      expect(more.className).toContain("pointer-coarse:min-h-10");
      expect(more.className).toContain("pointer-coarse:min-w-10");

      await userEvent.click(more);
      await userEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));

      expect(actions).toEqual(["rename"]);
    });

    it("opens an expandable row's Item Menu with Shift+F10 while the row has focus @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      const actions: string[] = [];
      function Plugin() {
        const [expanded, setExpanded] = useState(false);
        return (
          <ui.Collection label="Echoes" selectionMode="none">
            <ui.CollectionRow
              id="harbor"
              label="harbor"
              isExpandable
              isExpanded={expanded}
              onExpandedChange={(event) => setExpanded(event.detail)}
              menuItems={[{ value: "ignore", label: "Ignore this word" }]}
              onMenuAction={(event) => actions.push(event.detail)}
            >
              <ui.Text>harbor was calm</ui.Text>
            </ui.CollectionRow>
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);

      // Enter expands an expandable row, so its Item Menu needs the context-menu
      // gesture (Shift+F10) that Maibuk's other lists use.
      await userEvent.tab();
      await userEvent.keyboard("{Shift>}{F10}{/Shift}");
      await screen.findByRole("menu");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      expect(actions).toEqual(["ignore"]);
    });

    it("gives the kit IconButton a coarse-pointer target", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.IconButton label="Mark favourite" icon="star" />);
      const button = screen.getByRole("button", { name: "Mark favourite" });
      expect(button.className).toContain("pointer-coarse:min-h-10");
      expect(button.className).toContain("pointer-coarse:min-w-10");
    });

    it("keeps focus on the same row through a reordering update", async () => {
      harness = renderRemoteUi();
      const plugin = { setRows: (_: string[]) => {} };
      function Plugin() {
        const [order, setOrder] = useState(["one", "two", "three"]);
        plugin.setRows = setOrder;
        return (
          <ui.Collection label="Chapters" selectionMode="none">
            {order.map((id) => (
              <ui.CollectionRow key={id} id={id} label={id} />
            ))}
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);
      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      expect(document.activeElement).toHaveAttribute("data-key", "two");

      await act(async () => {
        plugin.setRows(["three", "one", "two"]);
      });

      expect(document.activeElement).toHaveAttribute("data-key", "two");
    });

    it("replaces the rows when the Plugin sends rows with new ids", async () => {
      harness = renderRemoteUi();
      let setRows: (rows: string[]) => void = () => {};
      function Plugin() {
        const [rows, set] = useState(["dark", "night"]);
        setRows = set;
        return (
          <ui.Collection label="Echoes" selectionMode="none">
            {/* Key by the Plugin's own position so the host reuses the remote node and only its id changes. */}
            {rows.map((id, index) => (
              <ui.CollectionRow key={index} id={id} label={id} />
            ))}
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);
      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "dark",
        "night",
      ]);

      await act(async () => {
        setRows(["p1", "p2", "p3"]);
      });

      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "p1",
        "p2",
        "p3",
      ]);
    });

    it("keeps focus in the listbox when the focused row is removed (Ignore this word)", async () => {
      harness = renderRemoteUi();
      let setRows: (rows: string[]) => void = () => {};
      function Plugin() {
        const [rows, set] = useState(["dark", "night", "gloom"]);
        setRows = set;
        return (
          <ui.Collection label="Echoes" selectionMode="none">
            {/* The report keys a row by its own id, so ignoring one leaves the other ids untouched. */}
            {rows.map((id) => (
              <ui.CollectionRow key={id} id={id} label={id} />
            ))}
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);
      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      expect(document.activeElement).toHaveTextContent("night");

      // The report removes the ignored row only; it never remounts the list.
      await act(async () => {
        setRows(["dark", "gloom"]);
      });

      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "dark",
        "gloom",
      ]);
      expect(screen.getByRole("listbox").contains(document.activeElement)).toBe(true);
    });

    it("keeps both rows when the Plugin replaces them with a reordered list", async () => {
      harness = renderRemoteUi();
      let setRows: (rows: string[]) => void = () => {};
      function Plugin() {
        const [rows, set] = useState(["dark", "night"]);
        setRows = set;
        return (
          <ui.Collection label="Echoes" selectionMode="none">
            {/* Key by the Plugin's own position so the host reuses the remote node and only its id changes. */}
            {rows.map((id, index) => (
              <ui.CollectionRow key={index} id={id} label={id} />
            ))}
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);

      await act(async () => {
        setRows(["night", "dark"]);
      });

      expect(screen.getAllByRole("option").map((row) => row.textContent)).toEqual([
        "night",
        "dark",
      ]);
    });

    it("renders a read-only table @ui:maibuk-table @ui:maibuk-table-row", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Table
          label="Statistics"
          columns={[
            { value: "name", label: "Name" },
            { value: "words", label: "Words" },
          ]}
        >
          <ui.TableRow
            cells={[
              { value: "name", label: "Book one" },
              { value: "words", label: "1200" },
            ]}
          />
        </ui.Table>
      );
      const table = screen.getByRole("table", { name: "Statistics" });
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((cell) => cell.textContent)
      ).toEqual(["Name", "Words"]);
      expect(
        within(table)
          .getAllByRole("cell")
          .map((cell) => cell.textContent)
      ).toEqual(["Book one", "1200"]);
    });
  });

  describe("overlays", () => {
    it("closes a modal on Escape and returns focus before the Plugin answers @ui-kbd:maibuk-modal", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        // The host must close on Escape at once and return focus, before the
        // Plugin's acknowledgement comes back over the Worker. The Plugin then
        // sets `isOpen` from the event, so it stays closed.
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal title="Details" isOpen={open} onOpenChange={(event) => setOpen(event.detail)}>
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      const trigger = screen.getByRole("button", { name: "Open details" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    });

    it("confirms and dismisses a confirmation dialog from the keyboard @ui-kbd:maibuk-confirm-dialog", async () => {
      harness = renderRemoteUi();
      let confirmed = 0;
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Ask</ui.Button>
            <ui.ConfirmDialog
              title="Delete chapter?"
              description="This cannot be undone."
              isDestructive
              isOpen={open}
              onConfirm={() => {
                confirmed += 1;
              }}
              onOpenChange={(event) => setOpen(event.detail)}
            />
          </>
        );
      }
      await harness.mount(<Plugin />);

      const trigger = screen.getByRole("button", { name: "Ask" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(
        await screen.findByRole("alertdialog", { name: "Delete chapter?" })
      ).toBeInTheDocument();

      await tabToButton("Confirm");
      await userEvent.keyboard("{Enter}");

      expect(confirmed).toBe(1);
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    });

    it("opens a popover from the keyboard and closes it with Escape @ui-kbd:maibuk-popover", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Popover label="Options">
          <ui.Text>Popover body</ui.Text>
        </ui.Popover>
      );

      const trigger = screen.getByRole("button", { name: "Options" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByText("Popover body")).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it("dismisses a modal on Escape and returns focus after the Worker stops @ui-kbd:maibuk-modal", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        // The Plugin never answers `onOpenChange`, and its Worker is stopped
        // after the dialog opens: the host must dismiss and return focus on its
        // own, never waiting for an echo.
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal title="Details" isOpen={open} onOpenChange={() => {}}>
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      const trigger = screen.getByRole("button", { name: "Open details" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      harness.stopWorker();

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);
    });

    it("dismisses a popover on Escape and returns focus after the Worker stops @ui-kbd:maibuk-popover", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Popover label="Options">
          <ui.Text>Popover body</ui.Text>
        </ui.Popover>
      );

      const trigger = screen.getByRole("button", { name: "Options" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByText("Popover body")).toBeInTheDocument();

      harness.stopWorker();

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(trigger));
    });

    it("reopens a modal after Escape when the Plugin ignores onOpenChange and keeps isOpen true", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        // The Plugin ignores `onOpenChange` and keeps `isOpen` true. Once its
        // Worker handles the host's dismissal, the SDK's internal `openSeq`
        // makes `isOpen` authoritative again, so the still-true `isOpen`
        // reopens the dialog.
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal title="Details" isOpen={open} onOpenChange={() => {}}>
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      // Escape dismisses at once; the Worker's answer then reopens it, because
      // the Plugin still says `isOpen` is true.
      await userEvent.keyboard("{Escape}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
    });

    it("reopens a modal after the Plugin acknowledges the dismissal and asks again", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal title="Details" isOpen={open} onOpenChange={(event) => setOpen(event.detail)}>
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      const trigger = screen.getByRole("button", { name: "Open details" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      // Escape: the host dismisses, the Plugin acknowledges with isOpen=false.
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.activeElement).toBe(trigger);

      // The Plugin asks again: isOpen=false -> true is a real reopen.
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
    });

    it("reopens a modal on a same-tick isOpen false then true", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Button
              onPress={() => {
                // Batched: the net is still true. Under the new contract the
                // Plugin's `isOpen` is authoritative again once it answers, so
                // this reopens the host's dialog.
                setOpen(false);
                setOpen(true);
              }}
            >
              Reopen in one tick
            </ui.Button>
            <ui.Modal title="Details" isOpen={open} onOpenChange={(event) => setOpen(event.detail)}>
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      // Escape: the host dismisses, the Plugin acknowledges with isOpen=false.
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Focus is back on the trigger; Tab to the reopen button and press it.
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
    });

    it("reopens a confirmation dialog when the Plugin answers Escape with a batched false then true @ui-kbd:maibuk-confirm-dialog", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Ask</ui.Button>
            <ui.ConfirmDialog
              title="Delete chapter?"
              description="This cannot be undone."
              isOpen={open}
              onOpenChange={(event) => {
                // Both updates batch into one render, so the net `isOpen` the
                // Plugin sends is unchanged (true). The SDK's internal openSeq
                // is what tells the host the Plugin said true again.
                setOpen(event.detail);
                setOpen(true);
              }}
            />
          </>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(
        await screen.findByRole("alertdialog", { name: "Delete chapter?" })
      ).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(
        await screen.findByRole("alertdialog", { name: "Delete chapter?" })
      ).toBeInTheDocument();
    });

    it("reopens a modal when the Plugin answers Escape with a batched false then true @ui-kbd:maibuk-modal", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal
              title="Details"
              isOpen={open}
              onOpenChange={(event) => {
                // Batched: the net `isOpen` the Plugin sends is unchanged
                // (true), the collapsed case the host cannot see. The SDK's
                // openSeq carries the Plugin's answer.
                setOpen(event.detail);
                setOpen(true);
              }}
            >
              <ui.Text>Modal body</ui.Text>
            </ui.Modal>
          </>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(await screen.findByRole("dialog", { name: "Details" })).toBeInTheDocument();
    });

    it("shows a tooltip on focus @ui-kbd:maibuk-tooltip", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Tooltip content="Save the chapter">
          <ui.Button>Save</ui.Button>
        </ui.Tooltip>
      );

      await userEvent.tab();

      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent("Save the chapter");
    });
  });

  describe("feedback", () => {
    it("renders a determinate progress bar @ui:maibuk-progress-bar", async () => {
      harness = renderRemoteUi();
      await harness.mount(<ui.ProgressBar label="Exporting" value={3} maxValue={4} />);
      const bar = screen.getByRole("progressbar", { name: "Exporting" });
      expect(bar).toHaveAttribute("aria-valuenow", "3");
      expect(bar).toHaveAttribute("aria-valuetext", "75%");
    });

    it("renders an inline status message @ui:maibuk-status", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <>
          <ui.Status>Saved</ui.Status>
          <ui.Status tone="danger">Could not save</ui.Status>
        </>
      );
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save");
    });

    it("renders an empty state @ui:maibuk-empty-state", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.EmptyState title="No notes yet" description="Notes you add appear here.">
          <ui.Button>Add note</ui.Button>
        </ui.EmptyState>
      );
      expect(screen.getByText("No notes yet")).toBeInTheDocument();
      expect(screen.getByText("Notes you add appear here.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add note" })).toBeInTheDocument();
    });
  });

  describe("appearance", () => {
    it("renders a themed surface by default @ui:maibuk-surface", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Surface>
          <ui.Text>Inside the surface</ui.Text>
        </ui.Surface>
      );
      const text = screen.getByText("Inside the surface");
      expect(text).toHaveClass("text-foreground");
      expect(document.querySelector("[data-plugin-ui]")).not.toBeNull();
    });

    it("scopes Plugin CSS to its own surface and away from Maibuk chrome", async () => {
      harness = renderRemoteUi({
        wrapper: ({ children }) => (
          <>
            <p data-testid="chrome">Maibuk chrome</p>
            {children}
          </>
        ),
      });
      await harness.mount(
        <>
          <ui.Surface css="p { color: rgb(1, 2, 3) }">
            <ui.Text>First plugin</ui.Text>
          </ui.Surface>
          <ui.Surface css="p { color: rgb(4, 5, 6) }">
            <ui.Text>Second plugin</ui.Text>
          </ui.Surface>
        </>
      );

      const first = screen.getByText("First plugin");
      const second = screen.getByText("Second plugin");
      const chrome = screen.getByTestId("chrome");

      // Each surface gets its own rule, so neither Plugin reaches the other.
      expect(getComputedStyle(first).color).toBe("rgb(1, 2, 3)");
      expect(getComputedStyle(second).color).toBe("rgb(4, 5, 6)");
      // The chrome carries neither surface's attribute, so Plugin CSS cannot reach it.
      expect(getComputedStyle(chrome).color).not.toBe("rgb(1, 2, 3)");
      expect(getComputedStyle(chrome).color).not.toBe("rgb(4, 5, 6)");
      // Every rule is prefixed; nothing can match outside a surface.
      for (const style of document.querySelectorAll("style")) {
        for (const rule of style.textContent?.split("}") ?? []) {
          if (rule.trim() === "") continue;
          expect(rule).toContain("[data-plugin-ui=");
        }
      }
    });

    it("keeps Maibuk chrome and a second surface intact under hostile Plugin CSS", async () => {
      harness = renderRemoteUi({
        wrapper: ({ children }) => (
          <>
            <p data-testid="chrome">Maibuk chrome</p>
            <span data-testid="chrome-span">Also chrome</span>
            {children}
          </>
        ),
      });
      const hostile = `
        p { color: rgb(1, 2, 3) }
        * { background-color: rgb(200, 1, 1) }
        :root { background-color: rgb(200, 2, 2) }
        html { background-color: rgb(200, 3, 3) }
        body { background-color: rgb(200, 4, 4) }
        ~ p { color: rgb(200, 5, 5) }
        + p { color: rgb(200, 6, 6) }
        :has(p) { background-color: rgb(200, 7, 7) }
        .a { b: url(} ) } body { display: none }
        @media (max-width: 10000px) { body { letter-spacing: 9px } }
      `;
      await harness.mount(
        <>
          <ui.Surface css={hostile}>
            <ui.Text>Hostile surface</ui.Text>
          </ui.Surface>
          <ui.Surface css="p { color: rgb(4, 5, 6) }">
            <ui.Text>Second surface</ui.Text>
          </ui.Surface>
          {/* A raw newline in a string is a bad-string to the browser: the whole
              stylesheet must be dropped, not passed through with an unscoped
              `body` rule. */}
          <ui.Surface css={'.a{b:"x\n} body{display:none} .z{c:"}'}>
            <ui.Text>Newline escape surface</ui.Text>
          </ui.Surface>
        </>
      );

      const hostileText = screen.getByText("Hostile surface");
      const secondText = screen.getByText("Second surface");
      const escapeText = screen.getByText("Newline escape surface");
      const chrome = screen.getByTestId("chrome");
      const chromeSpan = screen.getByTestId("chrome-span");

      // The safe part still reaches the Plugin's own surface.
      expect(getComputedStyle(hostileText).color).toBe("rgb(1, 2, 3)");
      // The second surface keeps its own rule.
      expect(getComputedStyle(secondText).color).toBe("rgb(4, 5, 6)");

      // None of the hostile rules reaches Maibuk chrome: the `}` inside url()
      // cannot break the block, the sibling combinators are dropped, and
      // `:root`/`html`/`body`/`:has()` are inert under the prefix.
      expect(getComputedStyle(chrome).color).not.toBe("rgb(1, 2, 3)");
      expect(getComputedStyle(chrome).backgroundColor).not.toBe("rgb(200, 1, 1)");
      expect(getComputedStyle(chrome).backgroundColor).not.toBe("rgb(200, 2, 2)");
      expect(getComputedStyle(chrome).backgroundColor).not.toBe("rgb(200, 3, 3)");
      expect(getComputedStyle(chrome).backgroundColor).not.toBe("rgb(200, 4, 4)");
      expect(getComputedStyle(chrome).backgroundColor).not.toBe("rgb(200, 7, 7)");
      expect(getComputedStyle(chrome).display).not.toBe("none");
      expect(getComputedStyle(chrome).letterSpacing).not.toBe("9px");
      expect(getComputedStyle(chromeSpan).color).not.toBe("rgb(1, 2, 3)");

      // The bad-string stylesheet is dropped whole: its `body{display:none}`
      // never reaches any style element, and the escape surface keeps the
      // chrome's styling.
      expect(getComputedStyle(escapeText).color).not.toBe("rgb(1, 2, 3)");
      for (const style of document.querySelectorAll("style")) {
        expect(style.textContent ?? "").not.toContain("body{display:none}");
      }
    });

    it("warns once when Plugin CSS was partly dropped, and not for clean CSS", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        harness = renderRemoteUi();
        await harness.mount(
          <>
            {/* An @import is dropped, so the dirty surface warns. */}
            <ui.Surface css="@import url(x); p { color: rgb(7, 8, 9) }">
              <ui.Text>Warned surface</ui.Text>
            </ui.Surface>
            {/* A clean stylesheet drops nothing, so it stays silent. */}
            <ui.Surface css="p { color: rgb(1, 2, 3) }">
              <ui.Text>Clean surface</ui.Text>
            </ui.Surface>
          </>
        );

        const dropped = warn.mock.calls.filter((call) =>
          String(call[0]).startsWith("Plugin CSS was partly or wholly dropped")
        );
        expect(dropped).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("collection sizing", () => {
    // The list fills the vertical space its scroll container leaves it, keeping
    // room for whatever renders after it (the Echoes "Show 200 more" button),
    // with a floor. jsdom has no layout, so every value the hook reads is mocked.
    const observerCallbacks: ResizeObserverCallback[] = [];
    let originalResizeObserver: typeof ResizeObserver;

    beforeEach(() => {
      observerCallbacks.length = 0;
      originalResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          observerCallbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
      globalThis.ResizeObserver = originalResizeObserver;
    });

    /** Gives an element the layout jsdom never computes. */
    function mockRect(element: Element, top: number, bottom: number) {
      element.getBoundingClientRect = () =>
        ({
          top,
          bottom,
          height: bottom - top,
          left: 0,
          right: 0,
          width: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    /** The scroller a Plugin page gives a Collection, with a button after it. */
    function scrollerWrapper({ children }: { children: ReactNode }) {
      return (
        <div data-testid="scroller" style={{ overflowY: "auto" }}>
          <div data-testid="content">{children}</div>
          <button type="button" data-testid="more">
            Show 200 more
          </button>
        </div>
      );
    }

    function manyRows(count: number) {
      return Array.from({ length: count }, (_, index) => (
        <ui.CollectionRow key={`r${index}`} id={`r${index}`} label={`Row ${index}`} />
      ));
    }

    /** Runs the hook's own measure, as a resize or observer tick does. */
    function remeasure() {
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
    }

    it("fills the scroller, leaving room for the content after the list", async () => {
      harness = renderRemoteUi({ wrapper: scrollerWrapper });
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      const list = screen.getByRole("listbox");
      mockRect(screen.getByTestId("scroller"), 0, 800);
      mockRect(list, 200, 520);
      mockRect(screen.getByTestId("more"), 520, 580);
      remeasure();

      // 800 (scroller) - 200 (list top) - 60 (content after) = 540.
      expect(list.style.maxHeight).toBe("540px");
    });

    it("counts the gap between the list and the content after it", async () => {
      harness = renderRemoteUi({ wrapper: scrollerWrapper });
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      const list = screen.getByRole("listbox");
      mockRect(screen.getByTestId("scroller"), 0, 800);
      mockRect(list, 200, 520);
      // An 8px flex gap, then the 60px button.
      mockRect(screen.getByTestId("more"), 528, 588);
      remeasure();

      // 800 - 200 - (8 + 60) = 532: the page does not overflow by the gap.
      expect(list.style.maxHeight).toBe("532px");
    });

    it("never shrinks below the 5-row floor", async () => {
      harness = renderRemoteUi({ wrapper: scrollerWrapper });
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      const list = screen.getByRole("listbox");
      mockRect(screen.getByTestId("scroller"), 0, 100);
      mockRect(list, 0, 40);
      remeasure();

      expect(list.style.maxHeight).toBe("192px");
    });

    it("falls back to 20rem when there is no layout to measure", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      // Every rect is zero in jsdom: the list stays at its old 20rem height.
      expect(screen.getByRole("listbox").style.maxHeight).toBe("320px");
    });

    it("re-measures when a ResizeObserver reports a change", async () => {
      harness = renderRemoteUi({ wrapper: scrollerWrapper });
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      const list = screen.getByRole("listbox");
      mockRect(screen.getByTestId("scroller"), 0, 800);
      mockRect(list, 200, 540);
      act(() => {
        for (const callback of observerCallbacks) callback([], {} as ResizeObserver);
      });
      expect(list.style.maxHeight).toBe("600px");

      // The "Show 200 more" button appears: the observer re-measures and makes room.
      mockRect(screen.getByTestId("more"), 540, 600);
      act(() => {
        for (const callback of observerCallbacks) callback([], {} as ResizeObserver);
      });
      expect(list.style.maxHeight).toBe("540px");
    });

    it("still navigates the rows with the arrow keys", async () => {
      harness = renderRemoteUi({ wrapper: scrollerWrapper });
      await harness.mount(
        <ui.Collection label="Many rows" selectionMode="none">
          {manyRows(40)}
        </ui.Collection>
      );

      await userEvent.tab();
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{ArrowDown}");

      expect(document.activeElement).toHaveAttribute("data-key", "r2");
    });
  });

  // Row labels (#527): the label keeps its natural width and the description
  // truncates first. jsdom has no layout, so the test marks which texts overflow.
  describe("collection row labels", () => {
    const LONG_LABEL = "The Long Harbor Chronicles of the Northern Coast";
    const LONG_DESCRIPTION =
      "Chapter 1 Opening, Chapter 4 Storm, Chapter 9 The Long Return, Chapter 12 Coda";
    let overflowing = new Set<string>();

    beforeEach(() => {
      overflowing = new Set();
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
        configurable: true,
        get(this: HTMLElement) {
          return overflowing.has(this.textContent ?? "") ? 500 : 100;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get() {
          return 100;
        },
      });
    });

    afterEach(() => {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
      Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
    });

    it("keeps a row's label visible when its description is long @ui:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_DESCRIPTION);
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label={LONG_LABEL} description={LONG_DESCRIPTION} />
        </ui.Collection>
      );

      const label = screen.getByText(LONG_LABEL);
      expect(label).toBeVisible();
      expect(label.className).toContain("shrink-0");
      expect(label.className).toContain("max-w-[60%]");
    });

    it("shows the full label and description in a tooltip on hover when something is cut off @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_DESCRIPTION);
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label={LONG_LABEL} description={LONG_DESCRIPTION} />
        </ui.Collection>
      );

      await userEvent.hover(screen.getByRole("option"));
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent(LONG_LABEL);
      expect(tooltip).toHaveTextContent(LONG_DESCRIPTION);
    });

    it("describes the row by its tooltip while the tooltip is shown @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_LABEL);
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label={LONG_LABEL} description="Short" />
        </ui.Collection>
      );

      const row = screen.getByRole("option");
      expect(row).not.toHaveAttribute("aria-describedby");
      await userEvent.hover(row);
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveAttribute("id");
      expect(row).toHaveAttribute("aria-describedby", tooltip.id);
      expect(row).toHaveAccessibleDescription(expect.stringContaining(LONG_LABEL));

      await userEvent.unhover(row);
      await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
      expect(row).not.toHaveAttribute("aria-describedby");
    });

    it("shows the same tooltip on keyboard focus @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_LABEL);
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label={LONG_LABEL} description="Short" />
        </ui.Collection>
      );

      await userEvent.tab();
      expect(document.activeElement).toHaveAttribute("data-key", "book");
      const tooltip = await screen.findByRole("tooltip");
      expect(tooltip).toHaveTextContent(LONG_LABEL);
      expect(tooltip).toHaveTextContent("Short");
    });

    it("shows no tooltip when nothing is truncated @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label="Short" description="Also short" />
        </ui.Collection>
      );

      await userEvent.tab();
      // The row tooltip opens without a delay on focus and hover, so once both
      // have settled a fitting row has shown none.
      await userEvent.hover(screen.getByRole("option"));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("wraps the full description when the row is expanded @ui-kbd:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_DESCRIPTION);
      function Plugin() {
        const [expanded, setExpanded] = useState(false);
        return (
          <ui.Collection label="Echoes" selectionMode="none">
            <ui.CollectionRow
              id="book"
              label={LONG_LABEL}
              description={LONG_DESCRIPTION}
              isExpandable
              isExpanded={expanded}
              onExpandedChange={(event) => setExpanded(event.detail)}
            >
              <ui.Text>Detail</ui.Text>
            </ui.CollectionRow>
          </ui.Collection>
        );
      }
      await harness.mount(<Plugin />);

      await userEvent.tab();
      await userEvent.keyboard("{Enter}");

      const description = await screen.findByText(LONG_DESCRIPTION);
      expect(description).toBeVisible();
      expect(description.className).toContain("whitespace-normal");
      expect(description.className).not.toContain("truncate");
    });

    it("gives screen readers the full label and description @ui:maibuk-collection-row", async () => {
      harness = renderRemoteUi();
      overflowing.add(LONG_DESCRIPTION);
      await harness.mount(
        <ui.Collection label="Echoes" selectionMode="none">
          <ui.CollectionRow id="book" label={LONG_LABEL} description={LONG_DESCRIPTION} />
        </ui.Collection>
      );

      const option = screen.getByRole("option");
      expect(option).toHaveAccessibleName(expect.stringContaining(LONG_LABEL));
      expect(option).toHaveAccessibleName(expect.stringContaining(LONG_DESCRIPTION));
    });
  });
});
