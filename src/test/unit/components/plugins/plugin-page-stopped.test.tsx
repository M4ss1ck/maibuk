/**
 * A Stopped Plugin's page (#618): the body is replaced by a panel that says
 * why, with Try again (or Review in Settings) and Plugin settings, all reached
 * by keyboard. Driven over a real lifecycle with fake Plugin frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pluginPageRoute } from "@/features/plugins/contributions-registry";
import { STARTUP_TIMEOUT_MS } from "@/features/plugins/runtime";
import {
  seedPluginSidebarFromSnapshot,
  writePluginSidebarSnapshot,
} from "@/features/plugins/sidebar-snapshot";
import { pluginCardRowId } from "@/features/settings/rows";
import { useSettingsRevealStore } from "@/features/settings/settings-reveal-store";
import { HEARTBEAT_INTERVAL_MS } from "@/features/plugins/lifecycle";
import type { PluginCommandId } from "@/lib/shortcut-registry";
import { PluginPage } from "@/pages/PluginPage";
import {
  advance,
  advanceUntil,
  createLifecycleHarness,
  disposeLifecycleHarness,
  invalidManifestFolder,
  pagePlugin,
} from "@/test/support/plugin-lifecycle-harness";

// The Remote UI body has its own suite; here it only marks that the page rendered.
vi.mock("@/features/plugins/remote-ui", () => ({
  PluginRemoteUiBoundary: () => <p>Plugin body</p>,
}));

const ON_DEMAND = { name: "Word Stats", lifecycle: "on-demand" as const };

beforeEach(() => {
  // user-event waits on real time between key events; let fake time follow it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  disposeLifecycleHarness();
  useSettingsRevealStore.getState().clearRow();
  useSettingsRevealStore.setState({ pendingPluginReviewId: null });
  vi.useRealTimers();
});

function renderPage(pluginId = "alpha"): void {
  render(
    <MemoryRouter initialEntries={[pluginPageRoute(pluginId, "report")]}>
      <Routes>
        <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
        <Route path="settings" element={<h1>Settings screen</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function keyboard() {
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

/** An on-demand page Plugin whose first start runs out of time on its page. */
async function timedOutOnItsPage() {
  const h = await createLifecycleHarness({
    approved: [pagePlugin("alpha", ON_DEMAND)],
    deferReady: true,
  });
  await h.launch();
  renderPage();
  await advanceUntil(() => h.framesFor("alpha").length === 1, "the warm start");
  await advance(STARTUP_TIMEOUT_MS + 1);
  await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the timeout");
  return h;
}

describe("a Stopped Plugin's page", () => {
  it("says why it stopped instead of an empty body", async () => {
    await timedOutOnItsPage();

    expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByText("Word Stats stopped")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Word Stats took too long to start and was stopped."
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plugin settings" })).toBeInTheDocument();
  });

  it("Try again from the keyboard shows Starting…, then the page once the Plugin is ready", async () => {
    const h = await timedOutOnItsPage();
    const user = keyboard();

    await user.tab();
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await advanceUntil(() => h.framesFor("alpha").length === 2, "the retry's frame");

    expect(screen.getByRole("status")).toHaveTextContent("Starting…");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();

    h.framesFor("alpha")[1].signalReady();
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText("Word Stats stopped")).toBeNull();
    expect(await screen.findByText("Plugin body")).toBeInTheDocument();
    // Focus stays on the page, not dropped to the document with the button.
    expect(screen.getByRole("heading", { name: "Report" })).toHaveFocus();
  });

  it("shows the new reason when the retried Plugin fails again", async () => {
    const h = await timedOutOnItsPage();
    const user = keyboard();

    await user.tab();
    await user.keyboard("{Enter}");
    await advanceUntil(() => h.framesFor("alpha").length === 2, "the retry's frame");
    h.framesFor("alpha")[1].signalReady();
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "ready", "ready");
    act(() => h.framesFor("alpha")[1].signalError("boom"));
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");

    expect(screen.getByRole("alert")).toHaveTextContent("Word Stats stopped unexpectedly.");
    expect(screen.queryByRole("status")).not.toHaveTextContent("Starting…");
  });

  it("Plugin settings from the keyboard opens the Plugin's Settings row", async () => {
    await timedOutOnItsPage();
    const user = keyboard();

    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Plugin settings" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
    expect(useSettingsRevealStore.getState().pendingRowId).toBe(pluginCardRowId("alpha"));
  });

  it("offers Review in Settings, not Try again, for a copy that changed", async () => {
    const h = await createLifecycleHarness({ changed: [pagePlugin("alpha", ON_DEMAND)] });
    await h.launch();
    renderPage();
    await advanceUntil(
      () =>
        h.lifecycle.state("alpha")?.status === "stopped" && screen.queryByRole("alert") !== null,
      "the review refusal"
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Plugin's files changed and need review."
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    const user = keyboard();
    await user.tab();
    expect(screen.getByRole("button", { name: "Review in Settings" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Settings screen" })).toBeInTheDocument();
    expect(useSettingsRevealStore.getState().pendingPluginReviewId).toBe("alpha");
  });

  it("explains a Plugin the launch scan refused, under the title its saved entry keeps", async () => {
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
    await h.launch();
    renderPage();

    expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("This Plugin's manifest is not valid.");
    expect(screen.getByRole("button", { name: "Review in Settings" })).toBeInTheDocument();
  });

  it("shows only a soft line while the Plugin is not responding", async () => {
    const h = await createLifecycleHarness({
      approved: [pagePlugin("alpha", { name: "Word Stats" })],
    });
    await h.launch();
    renderPage();
    h.framesFor("alpha")[0].holdAnswers = true;
    while (h.lifecycle.state("alpha")?.status !== "unavailable") {
      await advance(HEARTBEAT_INTERVAL_MS);
    }

    expect(
      screen.getByText("Word Stats is not responding. Waiting for it to answer…")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("replaces a Frame page's body with the same panel", async () => {
    const h = await createLifecycleHarness({
      approved: [
        pagePlugin(
          "alpha",
          {
            name: "Word Stats",
            customUi: true,
            contributes: {
              commands: [
                { id: "open", label: "Open report", contexts: ["global"], navigates: true },
              ],
              pages: [{ id: "report", title: "Report", command: "open", frame: "report.html" }],
            },
          },
          { "report.html": "<!doctype html><p>report</p>" }
        ),
      ],
    });
    await h.launch();
    renderPage();
    act(() => h.framesFor("alpha")[0].signalError("boom"));
    await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the crash");

    expect(screen.getByRole("alert")).toHaveTextContent("Word Stats stopped unexpectedly.");
    expect(screen.queryByTitle("Report")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
