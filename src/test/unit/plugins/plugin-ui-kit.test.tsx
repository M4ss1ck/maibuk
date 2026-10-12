// The Remote UI kit, part 2 (#439): organization, overlays, feedback, and
// Plugin CSS, driven through the real remote renderer. Every test mounts the
// Plugin's SDK tree, drives the host with `user-event`, and asserts the Plugin's
// handlers fired and the host's own state changed. Interactive rows carry a
// `@ui-kbd:<tag>` title; non-interactive rows carry `@ui:<tag>`.

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
      expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
        "Name",
        "Words",
      ]);
      expect(within(table).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
        "Book one",
        "1200",
      ]);
    });
  });

  describe("overlays", () => {
    it("closes a modal on Escape and returns focus without a Plugin echo @ui-kbd:maibuk-modal", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        // The Plugin never answers `onOpenChange`: this is a stopped or delayed
        // Worker, and the host must still dismiss and return focus.
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal title="Details" isOpen={open}>
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
              onOpenChange={() => {}}
            />
          </>
        );
      }
      await harness.mount(<Plugin />);

      const trigger = screen.getByRole("button", { name: "Ask" });
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByRole("alertdialog", { name: "Delete chapter?" })).toBeInTheDocument();

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

    it("does not reopen on a late isOpen=true the Plugin never acknowledged", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        const [tick, setTick] = useState(0);
        // The Plugin ignores `onOpenChange` and keeps `isOpen` true. A redraw
        // that sends no acknowledgement must not reopen the host's dialog.
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Button onPress={() => setTick((value) => value + 1)}>Redraw</ui.Button>
            <ui.Text>{`tick ${tick}`}</ui.Text>
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

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      // Focus is back on the trigger; Tab to Redraw and re-render with the
      // still-true `isOpen`.
      await userEvent.tab();
      await userEvent.keyboard("{Enter}");
      expect(await screen.findByText("tick 1")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("reopens a modal after the Plugin acknowledges the dismissal and asks again", async () => {
      harness = renderRemoteUi();
      function Plugin() {
        const [open, setOpen] = useState(false);
        return (
          <>
            <ui.Button onPress={() => setOpen(true)}>Open details</ui.Button>
            <ui.Modal
              title="Details"
              isOpen={open}
              onOpenChange={(event) => setOpen(event.detail)}
            >
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
        </>
      );

      const hostileText = screen.getByText("Hostile surface");
      const secondText = screen.getByText("Second surface");
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
    });
  });
});
