/**
 * The template's own test (issue #455): the same suite a Plugin author edits.
 * It drives the page through the supported test kit with `user-event` key
 * presses and asserts behavior, never attributes. It imports only the two
 * public entries (`@maibuk/plugin-sdk`, its public subpaths, and
 * `@maibuk/plugin-test-kit`), never a Maibuk-internal `@/...` module, which the
 * import-boundary step refuses.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createPluginClient, PLUGIN_COMMAND_RUN_REQUEST } from "@maibuk/plugin-sdk";
import { servePluginUi } from "@maibuk/plugin-sdk/ui-serve";
import { createTestHost } from "@maibuk/plugin-test-kit";
import { OPEN_COMMAND, PAGE_ID, start } from "./index";
import manifest from "./manifest.json";

/** The host's manifest type; the JSON manifest itself is validated by `plugin:check`. */
type TestManifest = Parameters<typeof createTestHost>[0]["manifest"];

/** A host with this Plugin's manifest, wired to the real Remote UI entry. */
function testHost() {
  const host = createTestHost({ manifest: manifest as unknown as TestManifest });
  start(createPluginClient(host.port), servePluginUi);
  return host;
}

/** Tabs forward until `element` has focus, so every action is reached by keyboard. */
async function tabTo(
  user: ReturnType<typeof userEvent.setup>,
  element: HTMLElement
): Promise<void> {
  for (let i = 0; i < 20 && document.activeElement !== element; i++) await user.tab();
}

describe("Hello Plugin", () => {
  it("opens its page when its Command runs", async () => {
    const host = testHost();
    try {
      await host.broker.request(PLUGIN_COMMAND_RUN_REQUEST, { id: OPEN_COMMAND });
      expect(host.pageNavigations).toEqual([{ pluginId: manifest.id, pageId: PAGE_ID }]);
    } finally {
      host.stop();
    }
  });

  it("greets the reader when its button is pressed with the keyboard", async () => {
    const host = testHost();
    try {
      const page = await host.renderPage(PAGE_ID);
      const user = userEvent.setup();

      expect(
        await screen.findByRole("heading", { name: "Hello from your Plugin" })
      ).toBeInTheDocument();
      const greet = screen.getByRole("button", { name: "Greet" });
      await tabTo(user, greet);
      expect(greet).toHaveFocus();

      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByText("Greetings: 1")).toBeInTheDocument());

      page.unmount();
    } finally {
      host.stop();
    }
  });
});
