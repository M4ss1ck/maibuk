/**
 * <PluginCommands /> is the real filter under test: it resolves the active
 * Shortcut Contexts from the live pathname (react-router's matchPath) and
 * binds only the Plugin Commands whose Contexts are active there, rendered
 * here under a MemoryRouter with the component's own bound-id reporting.
 *
 * Its warm-start effect reaches a surface for every Plugin whose Commands
 * live in the active Contexts; the test below pins that it reaches on a
 * membership change, not on every route change (which would re-arm idle
 * timer for Plugins that never left the screen).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { PluginCommands } from "@/components/plugins/PluginCommands";
import { useBoundShortcuts } from "@/lib/bound-shortcuts";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import type { PluginLifecycle } from "@/features/plugins/types";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const surfaceReached = vi.fn();
const surfaceLeft = vi.fn();

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
    {
      pluginId: "sample",
      manifest: { id: "sample" },
      folder: { name: "sample", files: [] },
      approval: { pluginId: "sample", pinnedHash: "h", granted: [] },
    },
  ],
  state: () => ({ status: "ready", startReason: "launch" }),
  runtime: () => null,
  surfaceReached,
  surfaceLeft,
} as unknown as PluginLifecycle;

const cleanups: Array<() => void> = [];

function registerRoutesPlugin(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        // Both targetless so their bindings go live once the Plugin is ready;
        // the Contexts differ per screen.
        commands: [
          { id: "edit", label: "Edit thing", contexts: ["editor"] },
          { id: "summarize", label: "Summarize", contexts: ["bookEditor"] },
        ],
      },
    }
  );
  const parsed = readPluginManifest(folder);
  if (!parsed.ok) throw new Error("fixture manifest is invalid");
  cleanups.push(registerPluginContributions({ manifest: parsed.manifest, folder }));
}

function BoundList(): string {
  const bound = useBoundShortcuts();
  return <output data-testid="bound">{bound.join(" ")}</output>;
}

function NavButton({ target, label }: { target: string; label: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(target)}>
      {label}
    </button>
  );
}

function boundIds(): string {
  return screen.getByTestId("bound").textContent ?? "";
}

async function navigateTo(user: Awaited<ReturnType<typeof userEvent.setup>>, target: string, label: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: label }));
  expect(screen.getByTestId("bound")).toBeInTheDocument();
}

function renderPluginCommands(): void {
  render(
    <MemoryRouter initialEntries={["/book/abc"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <PluginCommands />
              <BoundList />
              <NavButton target="/" label="home" />
              <NavButton target="/book/abc" label="book editor" />
              <NavButton target="/notes" label="notes list" />
              <NavButton target="/notes/n1" label="note editor" />
              <NavButton target="/canvas/c1" label="canvas" />
              <NavButton target="/settings" label="settings" />
              <NavButton target="/book/abc/cover" label="cover designer" />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  resetPluginContributionsForTests();
  surfaceReached.mockClear();
  surfaceLeft.mockClear();
});

describe("<PluginCommands /> route-matched Contexts", () => {
  it("binds a Command only where its Contexts are active", async () => {
    registerRoutesPlugin();
    const user = userEvent.setup();

    renderPluginCommands();
    // The book editor screen shows bookEditor and editor.
    expect(boundIds()).toContain("plugin.sample.edit");
    expect(boundIds()).toContain("plugin.sample.summarize");

    await navigateTo(user, "/", "home");
    expect(boundIds()).toBe("");

    await navigateTo(user, "/book/abc", "book editor");
    expect(boundIds()).toContain("plugin.sample.edit");
    expect(boundIds()).toContain("plugin.sample.summarize");

    await navigateTo(user, "/notes", "notes list");
    expect(boundIds()).toBe("");

    await navigateTo(user, "/notes/n1", "note editor");
    expect(boundIds()).toContain("plugin.sample.edit");
    expect(boundIds()).not.toContain("plugin.sample.summarize");

    await navigateTo(user, "/canvas/c1", "canvas");
    expect(boundIds()).toContain("plugin.sample.edit");

    await navigateTo(user, "/settings", "settings");
    expect(boundIds()).toBe("");

    await navigateTo(user, "/book/abc/cover", "cover designer");
    expect(boundIds()).not.toContain("plugin.sample.edit");
    expect(boundIds()).not.toContain("plugin.sample.summarize");
  });
});

describe("<PluginCommands /> warm start", () => {
  it("reaches each Plugin on membership changes only, not on every route change", async () => {
    registerRoutesPlugin();
    const user = userEvent.setup();
    renderPluginCommands();
    expect(surfaceReached).toHaveBeenCalledTimes(1);
    expect(surfaceReached).toHaveBeenLastCalledWith("sample", "context");
    expect(surfaceLeft).not.toHaveBeenCalled();

    // The editor Context is left once; no re-arm by a second pass.
    await navigateTo(user, "/", "home");
    expect(surfaceLeft).toHaveBeenCalledTimes(1);
    expect(surfaceLeft).toHaveBeenLastCalledWith("sample", "context");
    expect(surfaceReached).toHaveBeenCalledTimes(1);

    // Within routes without a Context for the Plugin: still nothing new.
    await navigateTo(user, "/settings", "settings");
    expect(surfaceReached).toHaveBeenCalledTimes(1);
    expect(surfaceLeft).toHaveBeenCalledTimes(1);

    // The membership rises again exactly once.
    await navigateTo(user, "/book/abc", "book editor");
    expect(surfaceReached).toHaveBeenCalledTimes(2);
    expect(surfaceReached).toHaveBeenLastCalledWith("sample", "context");
    expect(surfaceLeft).toHaveBeenCalledTimes(1);

    // The note editor keeps the membership exactly as the book did (editor).
    await navigateTo(user, "/notes/n1", "note editor");
    expect(surfaceReached).toHaveBeenCalledTimes(2);
    expect(surfaceLeft).toHaveBeenCalledTimes(1);
  });
});
