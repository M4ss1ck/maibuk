/**
 * The minimal host-rendered Plugin (issue #455). `manifest.json` declares one
 * page with a sidebar entry and one Command that opens it, and this module draws
 * that page with the SDK's host-rendered UI kit (`ui.*`), never its own HTML.
 * It never loads the Worker's Remote DOM polyfill: `index.tsx` does that and
 * then calls `start`, and a host-side test calls `start` directly over the
 * polyfill-free `@maibuk/plugin-sdk/ui-serve` entry.
 *
 * It imports only `@maibuk/plugin-sdk`, its public subpaths, and `react`; all of
 * them resolve to Maibuk's copies in build, test, and typecheck.
 */
import { useState, type ComponentType } from "react";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  type HostRequestHandler,
  type PluginClient,
  ui,
} from "@maibuk/plugin-sdk";

/** The page id, exactly as `manifest.json` declares it. */
export const PAGE_ID = "hello";

/** The Command-local id that opens the page, exactly as `manifest.json` declares it. */
export const OPEN_COMMAND = "openHello";

/**
 * The host's Remote UI and request entry (`servePluginUi`), Worker or test. The
 * two SDK entries share this shape, so `start` takes whichever the caller
 * supplies.
 */
export type HelloServe = (
  client: Pick<PluginClient, "onHostRequest">,
  options: {
    pages: Record<string, ComponentType>;
    onHostRequest?: HostRequestHandler;
  }
) => void;

/** The one page this Plugin serves: a heading, a greeting, and the button that adds one. */
function HelloPage() {
  const [greetings, setGreetings] = useState(0);
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading level={2}>Hello from your Plugin</ui.Heading>
      <ui.Text>{greetings === 0 ? "Press Greet to begin." : `Greetings: ${greetings}`}</ui.Text>
      <ui.Button onPress={() => setGreetings((count) => count + 1)}>Greet</ui.Button>
    </ui.View>
  );
}

/** Wires the client to the page and the Command handlers. */
export function start(client: PluginClient, serve: HelloServe): void {
  serve(client, {
    pages: { [PAGE_ID]: HelloPage },
    onHostRequest: (method, params) => handleHostRequest(client, method, params),
  });
}

/** Answers the host's requests: its health check, and this Plugin's one Command. */
function handleHostRequest(client: PluginClient, method: string, params: unknown): unknown {
  if (method === "health.check") return "pong";
  if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(client, params);
  throw new Error(`No handler for ${method}`);
}

/** Runs one Command; `openHello` opens the page. */
async function runCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: string };
  if (id === OPEN_COMMAND) await client.navigation.openPage({ pageId: PAGE_ID });
  return null;
}
