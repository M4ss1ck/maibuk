/**
 * A Plugin page opened with a return target (#786): it draws the host's
 * "Back to {title}" affordance, so the page that sent the reader here can be
 * reached again from the keyboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { pluginPageRoute } from "@/features/plugins/contributions-registry";
import { PluginPage } from "@/pages/PluginPage";
import {
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

function renderPage(state?: ReturnState): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: pluginPageRoute("alpha", "report"), state }]}>
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

async function openPage(state?: ReturnState): Promise<void> {
  const h = await createLifecycleHarness({ approved: [pagePlugin("alpha")] });
  await h.launch();
  renderPage(state);
}

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
});
