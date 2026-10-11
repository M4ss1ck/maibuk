import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { PluginPage } from "@/pages/PluginPage";
import {
  registerPluginContributions,
  resetPluginContributionsForTests,
} from "@/features/plugins/contributions";
import { readPluginManifest } from "@/features/plugins/runtime";
import { pluginFolder } from "@/test/support/plugin-fixtures";

const cleanups: Array<() => void> = [];

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
  state: () => ({ status: "stopped", reason: null, refusal: null }),
  runtime: () => null,
  installed: () => [],
  surfaceReached: () => undefined,
  surfaceLeft: () => undefined,
} as unknown as import("@/features/plugins/types").PluginLifecycle;

function registerSample(): void {
  const folder = pluginFolder(
    {},
    {
      id: "sample",
      name: "Sample",
      platforms: ["desktop"],
      contributes: {
        commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
        pages: [{ id: "report", title: "Sample report", command: "open" }],
        sidebarEntries: [{ page: "report", icon: "book-open" }],
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
});

describe("Plugin sidebar entry via keyboard", () => {
  it("opens its page from the keyboard", async () => {
    registerSample();
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>Home</div>} />
            <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const nav = screen.getByRole("listbox", { name: "Primary navigation" });
    const entry = within(nav).getByRole("option", { name: /Sample report/ });
    expect(entry).toBeInTheDocument();

    // Arrow to the Plugin entry from the first option, Enter opens its page.
    const books = within(nav).getByRole("option", { name: /^Books/ });
    books.focus();
    await user.keyboard("{ArrowDown}");
    // Arrow until the Plugin entry has focus (it follows Maibuk's entries).
    for (let i = 0; i < 10 && document.activeElement !== entry; i += 1) {
      await user.keyboard("{ArrowDown}");
    }
    expect(entry).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Sample report" })).toBeInTheDocument();
    });
  });
});

import { within } from "@testing-library/react";
