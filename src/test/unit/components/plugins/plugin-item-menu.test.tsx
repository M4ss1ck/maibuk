import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePluginItemMenuActions } from "@/hooks/usePluginItemMenuActions";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
import type { PluginItemTarget } from "@/features/plugins/commands";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];

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
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("Plugin Item Menu entry via keyboard", () => {
  it("runs with the menu's item as its target once ready", async () => {
    registerSample();
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

  it("does nothing from the keyboard until ready", async () => {
    registerSample();
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
