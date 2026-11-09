/**
 * The Book Item Menu on the Book Gallery card (#744): it holds the Plugins'
 * Book entries, opens from the keyboard Context Menu gesture (Shift+F10) on
 * the focused card, and runs the entry with the Book as the target. With no
 * Plugin entry, the card has no Item Menu at all.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GridList } from "react-aria-components/GridList";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookCard } from "@/components/project/BookCard";
import { useBookStore } from "@/features/books/store";
import type { Book } from "@/features/books/types";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import { mockItemMenuLayout } from "@/test/support/item-menu-layout";
import { pluginFolder } from "@/test/support/plugin-fixtures";

vi.mock("@/hooks/usePluginSurface", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePluginSurface")>();
  return {
    ...mod,
    useInstalledPluginLifecycle: () => stubLifecycle,
    usePluginLifecycleRevision: () => 0,
    usePluginSurface: () => undefined,
  };
});

let lifecycleStatus: "ready" | "stopped" = "ready";
let brokerRequest = vi.fn(async () => null);

vi.mock("@/hooks/usePluginSurface", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/usePluginSurface")>();
  return {
    ...mod,
    useInstalledPluginLifecycle: () => stubLifecycle,
    usePluginLifecycleRevision: () => 0,
    usePluginSurface: () => undefined,
  };
});

const stubLifecycle = {
  installed: () => [{ pluginId: "sample", manifest: {} }],
  state: (pluginId: string) =>
    pluginId === "sample"
      ? lifecycleStatus === "ready"
        ? { status: "ready", startReason: "launch" }
        : { status: "stopped", reason: null, refusal: null }
      : null,
  runtime: (pluginId: string) =>
    pluginId === "sample" && lifecycleStatus === "ready"
      ? ({ broker: { request: brokerRequest }, stop: vi.fn() } as unknown as PluginRuntime)
      : null,
  launchScanned: () => true,
  onLaunchScanned: () => () => undefined,
} as unknown as PluginLifecycle;

const cleanups: Array<() => void> = [];

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [{ id: "maps", label: "Maps", contexts: ["bookEditor"], targets: ["book"] }],
        itemMenuEntries: [{ command: "maps" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

const BOOK: Book = {
  id: "book-1",
  title: "Tides of Ash",
  authorName: "Ana",
  language: "en",
  wordCount: 0,
  status: "draft",
  createdAt: new Date(1),
  updatedAt: new Date(1),
  contentUpdatedAt: new Date(1),
};

function renderCard() {
  const view = render(
    <GridList aria-label="Books" layout="grid" selectionMode="none">
      <BookCard book={BOOK} onPress={vi.fn()} onStatusChange={vi.fn()} />
    </GridList>
  );
  mockItemMenuLayout(view.container);
  return view;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  useBookStore.setState({ books: [] });
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("BookCard Item Menu", () => {
  it("opens with Shift+F10 on the focused card and runs the Plugin entry for that Book", async () => {
    registerSample();
    useBookStore.setState({ books: [BOOK] });
    renderCard();
    const user = userEvent.setup();

    await user.tab();
    expect(screen.getByRole("row", { name: "Tides of Ash" })).toHaveFocus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    const entry = within(menu).getByRole("menuitem", { name: "Maps" });
    for (let i = 0; i < 5 && document.activeElement !== entry; i++) {
      await user.keyboard("{ArrowDown}");
    }
    expect(entry).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(brokerRequest).toHaveBeenCalledWith("command.run", {
        id: "maps",
        target: { kind: "book", id: "book-1" },
      })
    );
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes on Escape and gives focus back to the card", async () => {
    registerSample();
    useBookStore.setState({ books: [BOOK] });
    renderCard();
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await screen.findByRole("menu");
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(screen.getByRole("row", { name: "Tides of Ash" })).toHaveFocus();
    expect(brokerRequest).not.toHaveBeenCalled();
  });

  it("has no Item Menu when no Plugin contributes a Book entry", async () => {
    useBookStore.setState({ books: [BOOK] });
    renderCard();
    const user = userEvent.setup();

    await user.tab();
    await user.keyboard("{Shift>}{F10}{/Shift}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More actions for Tides of Ash" })
    ).not.toBeInTheDocument();
  });
});
