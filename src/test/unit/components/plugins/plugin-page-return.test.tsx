/**
 * A Plugin page opened with a return target (#786): it draws the host's
 * "Back to {title}" affordance, so the page that sent the reader here can be
 * reached again from the keyboard. It draws the same way for every page shape:
 * a Host-rendered page, a whole-page Frame, a `hideTitle` page, the stopped
 * panel, and the not-found page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pluginPageRoute } from "@/features/plugins/contributions-registry";
import { STARTUP_TIMEOUT_MS } from "@/features/plugins/runtime";
import { PluginPage } from "@/pages/PluginPage";
import {
  advance,
  advanceUntil,
  createLifecycleHarness,
  disposeLifecycleHarness,
  pagePlugin,
} from "@/test/support/plugin-lifecycle-harness";

// The Remote UI body has its own suite; here it only marks that the page rendered.
vi.mock("@/features/plugins/remote-ui", () => ({
  PluginRemoteUiBoundary: () => <p>Plugin body</p>,
}));

beforeEach(() => {
  // user-event waits on real time between key events; let fake time follow it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  disposeLifecycleHarness();
  vi.useRealTimers();
});

type ReturnState = { returnTo: string; returnLabel?: string };

type PageOptions = {
  pageId?: string;
  approved?: ReturnType<typeof pagePlugin>[];
  deferReady?: boolean;
};

function renderPage(state?: ReturnState, { pageId = "report" }: PageOptions = {}): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: pluginPageRoute("alpha", pageId), state }]}>
      <Routes>
        <Route path="plugin/:pluginId/:pageId" element={<PluginPage />} />
        <Route path="/canvas/:id" element={<p>canvas page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function keyboard() {
  return userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
}

async function openPage(state?: ReturnState, options: PageOptions = {}): Promise<void> {
  const h = await createLifecycleHarness({
    approved: options.approved ?? [pagePlugin("alpha")],
    deferReady: options.deferReady,
  });
  await h.launch();
  renderPage(state, options);
}

/** An on-demand page Plugin whose first start runs out of time on its page. */
async function timedOutOnItsPage(state?: ReturnState) {
  const h = await createLifecycleHarness({
    approved: [pagePlugin("alpha", { name: "Word Stats", lifecycle: "on-demand" })],
    deferReady: true,
  });
  await h.launch();
  renderPage(state);
  await advanceUntil(() => h.framesFor("alpha").length === 1, "the warm start");
  await advance(STARTUP_TIMEOUT_MS + 1);
  await advanceUntil(() => h.lifecycle.state("alpha")?.status === "stopped", "the timeout");
  return h;
}

const FRAME_PLUGIN = () =>
  pagePlugin(
    "alpha",
    {
      name: "Word Stats",
      customUi: true,
      contributes: {
        commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
        pages: [{ id: "report", title: "Report", command: "open", frame: "report.html" }],
      },
    },
    { "report.html": "<!doctype html><p>report</p>" }
  );

const HIDE_TITLE_PLUGIN = () =>
  pagePlugin("alpha", {
    name: "Word Stats",
    contributes: {
      commands: [{ id: "open", label: "Open report", contexts: ["global"], navigates: true }],
      pages: [{ id: "report", title: "Report", command: "open", hideTitle: true }],
    },
  });

describe("a Plugin page opened with a return target", () => {
  it("Back to its opener, from the keyboard, returns there", async () => {
    await openPage({ returnTo: "/canvas/c1", returnLabel: "Plot" });
    const user = keyboard();

    await user.tab();
    expect(screen.getByRole("button", { name: "Back to Plot" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByText("canvas page")).toBeInTheDocument();
  });

  it("draws no Back to button without a return target", async () => {
    await openPage();

    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
  });

  it("draws Back to its opener on a whole-page Frame", async () => {
    await openPage({ returnTo: "/canvas/c1", returnLabel: "Plot" }, { approved: [FRAME_PLUGIN()] });

    expect(screen.getByTitle("Report")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Plot" })).toHaveAttribute(
      "data-command",
      "pluginPage.back"
    );
  });

  it("draws Back to its opener on a hideTitle page", async () => {
    await openPage(
      { returnTo: "/canvas/c1", returnLabel: "Plot" },
      { approved: [HIDE_TITLE_PLUGIN()] }
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Report" });
    expect(heading.className).toContain("sr-only");
    expect(screen.getByRole("button", { name: "Back to Plot" })).toBeInTheDocument();
  });

  it("draws Back to its opener on the stopped panel", async () => {
    await timedOutOnItsPage({ returnTo: "/canvas/c1", returnLabel: "Plot" });

    expect(screen.getByText("Word Stats stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Plot" })).toBeInTheDocument();
  });

  it("draws Back to its opener on the not-found page", async () => {
    await openPage({ returnTo: "/canvas/c1", returnLabel: "Plot" }, { pageId: "nowhere" });

    expect(screen.getByText("This page's Plugin is not installed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Plot" })).toBeInTheDocument();
  });

  it("falls back to an untitled label when the opener has no label", async () => {
    await openPage({ returnTo: "/canvas/c1", returnLabel: "" });

    expect(screen.getByRole("button", { name: "Back to Untitled" })).toBeInTheDocument();
  });
});
