import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PluginToolbarButton } from "@/components/plugins/PluginToolbarButton";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle, PluginRuntime } from "@/features/plugins/types";
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
          { id: "plain", label: "Plain", contexts: ["global"] },
          { id: "targeted", label: "Targeted", contexts: ["global"], targets: ["chapter"] },
        ],
        toolbarButtons: [
          { id: "plainButton", command: "plain", icon: "book-open" },
          { id: "targetButton", command: "targeted", icon: "book-open" },
        ],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  lifecycleStatus = "ready";
  brokerRequest = vi.fn(async () => null);
});

describe("PluginToolbarButton with targets (#395)", () => {
  it("stays visible but disabled when its Command needs a target", () => {
    registerSample();

    render(<PluginToolbarButton id="plugin.sample.targetButton" iconSize="md" />);
    // Visible for discovery (#395: editor buttons remain visible), but unavailable:
    // an Item Menu supplies its item as the target, and with no suitable target
    // the Command is unavailable rather than guessed.
    const button = screen.getByRole("button", { name: "Targeted" });
    expect(button).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("enables a targetless Command once its Plugin is ready", () => {
    registerSample();

    render(<PluginToolbarButton id="plugin.sample.plainButton" iconSize="md" />);
    expect(screen.getByRole("button", { name: "Plain" })).toBeEnabled();
  });

  it("runs its Command from the keyboard once ready", async () => {
    registerSample();
    lifecycleStatus = "ready";
    const user = userEvent.setup();

    render(<PluginToolbarButton id="plugin.sample.plainButton" iconSize="md" />);
    const button = screen.getByRole("button", { name: "Plain" });
    button.focus();
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).toHaveBeenCalledWith("command.run", { id: "plain" });
  });

  it("does nothing from the keyboard until ready", async () => {
    registerSample();
    lifecycleStatus = "stopped";
    const user = userEvent.setup();

    render(<PluginToolbarButton id="plugin.sample.plainButton" iconSize="md" />);
    const button = screen.getByRole("button", { name: "Plain" });
    expect(button).toBeDisabled();
    button.focus();
    await user.keyboard("{Enter}");

    expect(brokerRequest).not.toHaveBeenCalled();
  });
});
