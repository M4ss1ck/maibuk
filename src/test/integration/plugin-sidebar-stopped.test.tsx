/**
 * A Stopped Plugin's sidebar entry (#618): marked, named with the reason for a
 * screen reader, tooltipped, and still the way to its page. The mark clears
 * when the Plugin is ready again or the author turns it off; a normal stop or
 * a Plugin that only misses heartbeats is never marked. Real lifecycle, fake
 * Plugin frames, the app's real Layout and English copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { getPluginApproval, savePluginApproval } from "@/features/plugins/approvals";
import { pluginPageRoute } from "@/features/plugins/contributions-registry";
import { HEARTBEAT_INTERVAL_MS } from "@/features/plugins/lifecycle";
import {
  seedPluginSidebarFromSnapshot,
  writePluginSidebarSnapshot,
} from "@/features/plugins/sidebar-snapshot";
import type { PluginCommandId } from "@/lib/shortcut-registry";
import {
  advance,
  advanceUntil,
  createLifecycleHarness,
  disposeLifecycleHarness,
  invalidManifestFolder,
  pagePlugin,
} from "@/test/support/plugin-lifecycle-harness";

const STOPPED_NAME = "Report, stopped. Word Stats stopped unexpectedly.";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  disposeLifecycleHarness();
  vi.useRealTimers();
});

function CurrentRoute() {
  return <output data-testid="route">{useLocation().pathname}</output>;
}

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="*" element={<CurrentRoute />} />
          <Route index element={<CurrentRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

function navigation() {
  return within(screen.getByRole("navigation", { name: "Primary navigation" }));
}

async function crashedWordStats() {
  const h = await createLifecycleHarness({
    approved: [pagePlugin("alpha", { name: "Word Stats" })],
  });
  await h.launch();
  renderLayout();
  act(() => h.framesFor("alpha")[0].signalError("boom"));
  await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");
  return h;
}

function keyboard() {
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

describe("a Stopped Plugin's sidebar entry", () => {
  it("is named with the reason and carries the mark", async () => {
    await crashedWordStats();

    const entry = navigation().getByRole("option", { name: STOPPED_NAME });
    expect(entry.querySelector("[data-plugin-stopped-mark]")).not.toBeNull();
  });

  it("shows the reason in a tooltip when focused, and still opens its page", async () => {
    await crashedWordStats();
    const user = keyboard();

    // Tab into the navigation list, then walk it with the arrows to the entry.
    while (document.activeElement?.getAttribute("role") !== "option") await user.tab();
    const entry = navigation().getByRole("option", { name: STOPPED_NAME });
    while (document.activeElement !== entry) await user.keyboard("{ArrowDown}");
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Word Stats stopped unexpectedly."
    );

    await user.keyboard("{Enter}");
    expect(screen.getByTestId("route")).toHaveTextContent(pluginPageRoute("alpha", "report"));
  });

  it("is marked the same way in the mobile navigation", async () => {
    await crashedWordStats();
    const user = keyboard();

    await user.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const menu = within(screen.getByRole("dialog", { name: "Primary navigation" }));

    expect(menu.getByRole("option", { name: STOPPED_NAME })).toBeInTheDocument();
  });

  it("clears once the Plugin is ready again", async () => {
    const h = await crashedWordStats();

    void h.lifecycle.start("alpha", "restart");
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");

    expect(navigation().getByRole("option", { name: "Report" })).toBeInTheDocument();
    expect(document.querySelector("[data-plugin-stopped-mark]")).toBeNull();
  });

  it("clears when the author disables the Plugin", async () => {
    const h = await crashedWordStats();
    const approval = getPluginApproval("alpha");
    if (!approval) throw new Error("fixture approval missing");

    savePluginApproval({ ...approval, enabled: false });
    act(() => h.lifecycle.uninstall("alpha"));

    expect(document.querySelector("[data-plugin-stopped-mark]")).toBeNull();
  });

  it("is not marked after a requested stop, nor while only missing heartbeats", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { name: "Word Stats" })],
    });
    await h.launch();
    renderLayout();

    h.framesFor("alpha")[0].holdAnswers = true;
    while (h.lifecycle.state("alpha")?.status !== "unavailable") {
      await advance(HEARTBEAT_INTERVAL_MS);
    }
    expect(navigation().getByRole("option", { name: "Report" })).toBeInTheDocument();

    act(() => h.lifecycle.stop("alpha"));
    expect(navigation().getByRole("option", { name: "Report" })).toBeInTheDocument();
    expect(document.querySelector("[data-plugin-stopped-mark]")).toBeNull();
  });

  it("keeps and marks the entry of a Plugin the launch scan refused", async () => {
    writePluginSidebarSnapshot([
      {
        pluginId: "alpha",
        displayName: "Word Stats",
        pageId: "report",
        pageRoute: pluginPageRoute("alpha", "report"),
        title: "Report",
        commandId: "plugin.alpha.open" as PluginCommandId,
      },
    ]);
    const h = await createLifecycleHarness({ refusedAtScan: [invalidManifestFolder("alpha")] });
    seedPluginSidebarFromSnapshot();
    renderLayout();
    await h.launch();

    expect(
      navigation().getByRole("option", {
        name: "Report, stopped. This Plugin's manifest is not valid.",
      })
    ).toBeInTheDocument();
  });
});
