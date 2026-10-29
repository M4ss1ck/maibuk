/**
 * The Notes list row (NoteListItem) carries Maibuk's own actions and then the
 * Plugin Item Menu entries for its kind, with the Note as the target (#437).
 * The menu opens from the keyboard: Enter on the entry has reached the
 * Plugin's Worker with `{ kind: "note", id }`.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteListItem } from "@/components/notes/NoteListItem";
import { mockItemMenuLayout } from "@/test/support/item-menu-layout";
import { useNoteStore } from "@/features/notes/store";
import type { Note } from "@/features/notes";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

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
        commands: [
          { id: "inspect", label: "Inspect note", contexts: ["noteItem"], targets: ["note"] },
        ],
        itemMenuEntries: [{ command: "inspect" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

function buildNote(): Note {
  return {
    id: "note-1",
    bookId: null,
    title: "Watch journal",
    content: "<p>Preview</p>",
    language: "en",
    tags: [],
    order: 0,
    wordCount: 1,
    createdAt: 1,
    updatedAt: 1,
    contentUpdatedAt: 1,
    pinned: false,
    collapsedHeadings: [],
  };
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  useNoteStore.setState({ notes: [] });
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("NoteListItem Plugin Item Menu entries", () => {
  it("appends the Plugin's entry after Maibuk's own and runs it with the Note as the target", async () => {
    registerSample();
    useNoteStore.setState({ notes: [buildNote()], isLoading: false, error: null });
    const user = userEvent.setup();
    const { container } = render(
      <NoteListItem note={buildNote()} isSelected={false} onSelect={vi.fn()} onRename={vi.fn()} />
    );
    mockItemMenuLayout(container);

    await user.pointer({ target: screen.getByText("Watch journal"), keys: "[MouseRight]" });
    const menu = await screen.findByRole("menu");
    const names = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    // Maibuk's actions come first; the Plugin's entry is appended after them.
    expect(names[0]).toBe("Rename");
    expect(names[names.length - 1]).toBe("Inspect note");

    const entry = screen.getByRole("menuitem", { name: "Inspect note" });
    expect(entry).toBeEnabled();
    entry.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(brokerRequest).toHaveBeenCalledWith("command.run", {
        id: "inspect",
        target: { kind: "note", id: "note-1" },
      })
    );
  });

  it("cancels from the live store read when the Note is gone", async () => {
    registerSample();
    // The row is rendered from data the store no longer holds: the entry must
    // not reach the Plugin with a target the host cannot vouch for.
    const user = userEvent.setup();
    const { container } = render(
      <NoteListItem note={buildNote()} isSelected={false} onSelect={vi.fn()} onRename={vi.fn()} />
    );
    mockItemMenuLayout(container);

    await user.pointer({ target: screen.getByText("Watch journal"), keys: "[MouseRight]" });
    const entry = await screen.findByRole("menuitem", { name: "Inspect note" });
    entry.focus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });
});
