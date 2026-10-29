/**
 * A target Command's Shortcut, pressed while its item's row has focus, runs
 * that row's target (#437, the #397 contract). `useItemCommands` is what binds
 * it: the Item Menu's actions carry their `commandId`, and the row that has
 * focus binds them, so pressing the Command's keys is the Item Menu's run with
 * the row's item. Nothing must happen while the Plugin is not ready, or while
 * focus is outside the row (the global PluginCommands binding keeps a target
 * Command disabled, #395).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GridList, GridListItem } from "react-aria-components/GridList";
import { ChapterList } from "@/components/editor/ChapterList";
import { NoteListItem } from "@/components/notes/NoteListItem";
import { PluginCommands } from "@/components/plugins/PluginCommands";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import type { Note } from "@/features/notes";
import { useNoteStore } from "@/features/notes/store";
import { useChapterStore } from "@/features/chapters/store";
import { useShortcutSettingsStore } from "@/features/settings/shortcut-store";
import { DEFAULT_SHORTCUT_SETTINGS } from "@/lib/shortcut-resolve";
import { buildChapter } from "@/test/support/fixtures";
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

vi.mock("@/lib/platform/detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform/detect")>()),
  isMac: () => false,
}));

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
  surfaceReached: vi.fn(),
  surfaceLeft: vi.fn(),
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
          {
            id: "tag",
            label: "Tag chapter",
            contexts: ["chapterItem"],
            targets: ["chapter"],
            defaults: [["Mod+Alt+g"]],
          },
          {
            id: "inspect",
            label: "Inspect note",
            contexts: ["noteItem"],
            targets: ["note"],
            defaults: [["Mod+Alt+b"]],
          },
        ],
        itemMenuEntries: [{ command: "tag" }, { command: "inspect" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok)
    throw new Error(`fixture manifest is invalid: ${JSON.stringify(parsed.problems)}`);
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

/**
 * The four-ways fixture: one target Command that declares both a screen Context
 * (`global`) and an item Context (`chapterItem`). Both the app shell's screen
 * binding and the focused row's binding match it (#446).
 */
function registerFourWays(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          {
            id: "stamp",
            label: "Stamp",
            contexts: ["global", "chapterItem"],
            targets: ["chapter"],
            defaults: [["Mod+Alt+e"]],
          },
        ],
        itemMenuEntries: [{ command: "stamp" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok)
    throw new Error(`fixture manifest is invalid: ${JSON.stringify(parsed.problems)}`);
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

function renderChapterList(): void {
  // `pluginTargetIsLive` re-reads the store, not the render props.
  useChapterStore.setState({ chapters: [buildChapter({ id: "ch-1", title: "First" })] });
  // The app shell's global binding is mounted too, so "focus outside the row"
  // fails on that binding if it ever stops keeping a target Command disabled.
  render(
    <MemoryRouter initialEntries={["/book/book-1"]}>
      <Routes>
        <Route
          path="/book/:bookId"
          element={
            <>
              <PluginCommands />
              <ChapterList
                chapters={[buildChapter({ id: "ch-1", title: "First" })]}
                currentChapterId="ch-1"
                onSelectChapter={vi.fn()}
                onCreateChapter={vi.fn()}
                onUpdateChapter={vi.fn()}
                onDeleteChapter={vi.fn()}
                onReorderChapters={vi.fn()}
              />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * The Book editor with Chapter A open in it and both Chapter rows rendered, so
 * a test can focus either row. The app shell's screen binding and a row's
 * `useItemCommands` binding both match the same target Command.
 */
function renderBookEditor(): void {
  const chapterA = buildChapter({ id: "ch-1", title: "First" });
  const chapterB = buildChapter({ id: "ch-2", title: "Second" });
  useChapterStore.setState({ chapters: [chapterA, chapterB], currentChapter: chapterA });
  render(
    <MemoryRouter initialEntries={["/book/book-1"]}>
      <Routes>
        <Route
          path="/book/:bookId"
          element={
            <>
              <PluginCommands />
              <ChapterList
                chapters={[chapterA, chapterB]}
                currentChapterId="ch-1"
                onSelectChapter={vi.fn()}
                onCreateChapter={vi.fn()}
                onUpdateChapter={vi.fn()}
                onDeleteChapter={vi.fn()}
                onReorderChapters={vi.fn()}
              />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderNoteRow(): void {
  const note = buildNote();
  render(
    <GridList aria-label="Notes" items={[note]}>
      {(item) => (
        <GridListItem id={item.id} textValue={item.title}>
          <NoteListItem note={item} isSelected={false} onSelect={vi.fn()} />
        </GridListItem>
      )}
    </GridList>
  );
}

beforeEach(() => {
  useShortcutSettingsStore.setState({ shortcuts: structuredClone(DEFAULT_SHORTCUT_SETTINGS) });
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  useNoteStore.setState({ notes: [] });
  useChapterStore.setState({ chapters: [], currentChapter: null });
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

const pressChapterCommand = "{Control>}{Alt>}g{/Alt}{/Control}";
const pressNoteCommand = "{Control>}{Alt>}b{/Alt}{/Control}";

describe("a target Command's Shortcut on its focused row", () => {
  it("runs a Chapter row's Command with the row as the target", async () => {
    registerSample();
    const user = userEvent.setup();
    renderChapterList();

    const row = screen.getByRole("row", { name: "First" });
    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard(pressChapterCommand);

    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "tag",
      target: { kind: "chapter", id: "ch-1" },
    });
  });

  it("runs a Note row's Command with the row as the target", async () => {
    registerSample();
    useNoteStore.setState({ notes: [buildNote()], isLoading: false, error: null });
    const user = userEvent.setup();
    renderNoteRow();

    const row = screen.getByRole("row", { name: "Watch journal" });
    row.focus();
    expect(row).toHaveFocus();
    await user.keyboard(pressNoteCommand);

    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "inspect",
      target: { kind: "note", id: "note-1" },
    });
  });

  it("does nothing while the Plugin is not ready", async () => {
    registerSample();
    lifecycleStatus = "stopped";
    const user = userEvent.setup();
    renderChapterList();

    const row = screen.getByRole("row", { name: "First" });
    row.focus();
    await user.keyboard(pressChapterCommand);

    expect(brokerRequest).not.toHaveBeenCalled();
  });

  it("does nothing while focus is outside the row", async () => {
    registerSample();
    const user = userEvent.setup();
    renderChapterList();

    const row = screen.getByRole("row", { name: "First" });
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Outside";
    document.body.append(outside);
    outside.focus();
    expect(row).not.toHaveFocus();
    await user.keyboard(pressChapterCommand);

    expect(brokerRequest).not.toHaveBeenCalled();
    outside.remove();
  });

  it("runs a target Command once on its focused row, which wins over the screen binding", async () => {
    registerFourWays();
    const user = userEvent.setup();
    renderBookEditor();

    // Chapter A is open in the editor; Chapter B's row has focus. The row is the
    // more specific Context, so the Command runs on B, once (#446).
    const rowB = screen.getByRole("row", { name: "Second" });
    rowB.focus();
    expect(rowB).toHaveFocus();
    await user.keyboard("{Control>}{Alt>}e{/Alt}{/Control}");

    expect(brokerRequest).toHaveBeenCalledTimes(1);
    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "stamp",
      target: { kind: "chapter", id: "ch-2" },
    });
  });

  it("runs a target Command once on the open Chapter when no item row has focus", async () => {
    registerFourWays();
    const user = userEvent.setup();
    renderBookEditor();

    // No row is focused: the app shell's screen binding is the only match and
    // runs against the Chapter open in the editor.
    const outside = document.createElement("button");
    outside.type = "button";
    outside.textContent = "Outside";
    document.body.append(outside);
    outside.focus();
    await user.keyboard("{Control>}{Alt>}e{/Alt}{/Control}");

    expect(brokerRequest).toHaveBeenCalledTimes(1);
    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "stamp",
      target: { kind: "chapter", id: "ch-1" },
    });
    outside.remove();
  });
});
