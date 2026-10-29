import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePluginItemMenuActions } from "@/hooks/usePluginItemMenuActions";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { Chapter } from "@/features/chapters/types";
import { useChapterStore } from "@/features/chapters/store";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import type { PluginItemTarget } from "@/features/plugins/commands";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];

let lifecycleStatus: "ready" | "stopped" = "ready";
let brokerRequest = vi.fn(async () => null);
let warmOnIntent = false;
const startSpy = vi.fn(async () => {
  lifecycleStatus = "ready";
  return { ok: true as const, startReason: "warmStart" as const };
});

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
  installed: () => [
    { pluginId: "sample", manifest: { warmStart: warmOnIntent ? "intent" : "surface" } },
  ],
  start: startSpy,
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
} as unknown as PluginLifecycle;

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [
          { id: "tag", label: "Tag chapter", contexts: ["chapterItem"], targets: ["chapter"] },
        ],
        itemMenuEntries: [{ command: "tag" }],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

/** Seeds the Chapter the menu item targets; the live read is the store, not a constant. */
function seedChapters(ids: string[]): void {
  useChapterStore.setState({
    chapters: ids.map<Chapter>((id) => ({ id }) as unknown as Chapter),
  });
}

function MenuHarness({ target }: { target: PluginItemTarget }) {
  const buildActions = usePluginItemMenuActions("chapter");
  const actions = buildActions(target);
  return (
    <div role="menu" aria-label="Chapter actions">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          disabled={action.isDisabled}
          onClick={action.onAction}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  useChapterStore.setState({ chapters: [] });
  lifecycleStatus = "ready";
  warmOnIntent = false;
  startSpy.mockClear();
  brokerRequest = vi.fn(async () => null);
});

describe("Plugin Item Menu entry via keyboard", () => {
  it("runs with the menu's item as its target once ready", async () => {
    registerSample();
    seedChapters(["c1"]);
    lifecycleStatus = "ready";
    const user = userEvent.setup();

    render(<MenuHarness target={{ kind: "chapter", id: "c1" }} />);
    const entry = screen.getByRole("menuitem", { name: "Tag chapter" });
    expect(entry).toBeEnabled();
    entry.focus();
    expect(entry).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", {
      id: "tag",
      target: { kind: "chapter", id: "c1" },
    });
  });

  it("reads the target live: an item deleted from the store cancels before the request", async () => {
    registerSample();
    seedChapters(["other"]);
    const user = userEvent.setup();

    render(<MenuHarness target={{ kind: "chapter", id: "c1" }} />);
    const entry = screen.getByRole("menuitem", { name: "Tag chapter" });
    entry.focus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });

  it("does nothing from the keyboard until ready", async () => {
    registerSample();
    seedChapters(["c1"]);
    lifecycleStatus = "stopped";
    const user = userEvent.setup();

    render(<MenuHarness target={{ kind: "chapter", id: "c1" }} />);
    const entry = screen.getByRole("menuitem", { name: "Tag chapter" });
    expect(entry).toBeDisabled();
    entry.focus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });
});

describe("Plugin Item Menu entry of a warm-on-intent Plugin", () => {
  it("stays enabled while stopped, and running it warm-starts the Plugin before the Command", async () => {
    registerSample();
    seedChapters(["c1"]);
    warmOnIntent = true;
    lifecycleStatus = "stopped";
    const user = userEvent.setup();

    render(<MenuHarness target={{ kind: "chapter", id: "c1" }} />);
    const entry = screen.getByRole("menuitem", { name: "Tag chapter" });
    expect(entry).toBeEnabled();
    entry.focus();
    await user.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(brokerRequest).toHaveBeenCalledWith("command.run", {
        id: "tag",
        target: { kind: "chapter", id: "c1" },
      })
    );
    expect(startSpy).toHaveBeenCalledWith("sample", "warmStart");
  });
});
