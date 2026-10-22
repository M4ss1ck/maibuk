// The fixture-stopped Plugin (issue #618): one on-demand Plugin that a spec can
// crash on demand, so the E2E lane proves the Stopped Plugin surfaces on the
// real app. Its `report` page draws a Remote UI tree whose Heading identifies
// the body, which the panel replaces once the Plugin stops; `health.check`
// answers `pong` like every fixture; the `crash` Command schedules an uncaught
// error in a fresh task, so the Worker itself dies rather than the Command
// reporting a refusal:
//
//   setTimeout(() => { throw new Error("fixture crash"); }, 0);
//
// The host hears the Worker's error event and stops the Plugin with reason
// `crashed`, whose copy is "<name> stopped unexpectedly." An on-demand Plugin
// stopped by a limit is never restarted automatically, so it stays a Stopped
// Plugin until the author presses Try again.
//
// Built from this source into e2e/.output/plugins/fixture-stopped by the E2E
// global setup; the bundle is never committed and never shipped.
//
// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports, exactly as the other fixture Plugins do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  createPluginClient,
  ui,
  type PluginClient,
} from "@/plugin-sdk";

/** The `report` page: the body a Stopped Plugin's panel replaces. */
function Report() {
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Stopped fixture body</ui.Heading>
    </ui.View>
  );
}

/**
 * Answers the host's `command.run`: `crash` kills the Worker from a fresh task,
 * so the reply to this Command is already on its way when the error fires.
 * Every other Command still replies, so the host reports that it ran.
 */
async function runCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: string };
  if (id === "crash") {
    setTimeout(() => {
      throw new Error("fixture crash");
    }, 0);
    return null;
  }
  await client.notifications.show({
    variant: "info",
    message: `stopped fixture ran ${id ?? "unknown"}`,
  });
  return null;
}

if (
  typeof self !== "undefined" &&
  typeof WorkerGlobalScope !== "undefined" &&
  self instanceof WorkerGlobalScope
) {
  self.onmessage = (event) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    const client = createPluginClient(port);
    servePluginUi(client, {
      pages: { report: Report },
      onHostRequest: (method, params) => {
        if (method === "health.check") return "pong";
        if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(client, params);
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
