/**
 * Clock's Plugin-level behavior through the supported Plugin test kit: the real
 * broker, method table, and Remote UI renderer. The runtime is driven over the
 * polyfill-free `@/plugin-sdk/ui-serve` entry, the same one the kit's jsdom
 * uses; `index.tsx` (the Worker bootstrap) is never imported.
 *
 * The Timer, Pomodoro, Stopwatch, and Alarms behavior arrives in their own
 * tickets. This unit proves the page opens from the Open Clock Command, the
 * tabs switch with the keyboard alone, the labels follow the app language, and
 * the Start or pause the Timer Command is registered.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { createTestHost } from "@/features/plugins/test-kit";
import { createPluginClient } from "@/plugin-sdk";
import { PLUGIN_COMMAND_RUN_REQUEST } from "@/plugin-sdk/protocol";
import { servePluginUi } from "@/plugin-sdk/ui-serve";
import en from "./locales/runtime/en.json";
import es from "./locales/runtime/es.json";
import { CLOCK_PAGE_ID, OPEN_CLOCK, TOGGLE_TIMER, startClock } from "./runtime";
import { clockManifest, tabTo } from "./test-support";

describe("Clock runtime", () => {
  it("opens the Clock page from the openClock Command and draws its four tabs", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);

      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_CLOCK });
      expect(host.pageNavigations).toEqual([{ pluginId: "maibuk-clock", pageId: CLOCK_PAGE_ID }]);

      const page = await host.renderPage(CLOCK_PAGE_ID);
      expect(await screen.findByRole("heading", { name: en.heading })).toBeInTheDocument();
      for (const label of [en.pomodoro, en.timer, en.stopwatch, en.alarms]) {
        expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
      }
      // The Timer is selected first, and its panel says it is coming soon.
      expect(screen.getByRole("tab", { name: en.timer })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.timer);
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.comingSoon);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("moves from Timer to Stopwatch with the keyboard alone", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(CLOCK_PAGE_ID);
      const user = userEvent.setup();

      const timerTab = await screen.findByRole("tab", { name: en.timer });
      await tabTo(user, timerTab);
      expect(timerTab).toHaveFocus();

      await user.keyboard("{ArrowRight}");

      const stopwatchTab = screen.getByRole("tab", { name: en.stopwatch });
      expect(stopwatchTab).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.stopwatch);
      expect(screen.getByRole("tabpanel")).toHaveTextContent(en.comingSoon);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("renders every label in Spanish when the app language is Spanish", async () => {
    const host = createTestHost({ manifest: clockManifest(), language: "es" });
    try {
      startClock(createPluginClient(host.port), servePluginUi);
      const page = await host.renderPage(CLOCK_PAGE_ID);

      expect(await screen.findByRole("heading", { name: es.heading })).toBeInTheDocument();
      for (const label of [es.pomodoro, es.timer, es.stopwatch, es.alarms]) {
        expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
      }
      expect(screen.getByRole("tabpanel")).toHaveTextContent(es.timer);
      expect(screen.getByRole("tabpanel")).toHaveTextContent(es.comingSoon);

      await page.unmount();
    } finally {
      await host.stop();
    }
  });

  it("registers the toggleTimer Command, which does nothing yet", async () => {
    const host = createTestHost({ manifest: clockManifest() });
    try {
      startClock(createPluginClient(host.port), servePluginUi);

      await expect(
        host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: TOGGLE_TIMER })
      ).resolves.toBeNull();
      expect(host.pageNavigations).toEqual([]);
    } finally {
      await host.stop();
    }
  });
});
