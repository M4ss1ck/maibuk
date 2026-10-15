// The fixture-frame Plugin (issue #454 unit U6, D7): one Plugin that declares
// `customUi: true`, a whole-page Frame (`ui/page.html`) and a Remote UI page
// that embeds a kit Frame (`ui/embed.html`). The Worker is the Frame's only
// host channel: it keeps each mounted Frame's port from `client.onFrame`,
// answers a `ping` with `pong`, and forwards the current UI language to every
// open Frame — on start and on every later change (`client.on("language.changed")`,
// the existing language event the Worker receives). It also drives the
// self-navigation probes: a `navigateData`/`navigateBlob` Command tells the open
// Frame to navigate itself, and the spec asserts nothing reaches the recorder.
//
// Built from this source into e2e/.output/plugins/fixture-frame by the E2E
// global setup; the bundle is never committed and never shipped. The Frame's
// own `ui/` files are copied verbatim by the same setup (they are not bundled),
// so a relative `import` there would not resolve: the Frame scripts are classic
// scripts, exactly what an opaque-origin Frame can load.
//
// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports, exactly as the other fixture Plugins do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import {
  PLUGIN_COMMAND_RUN_REQUEST,
  createPluginClient,
  ui,
  type PluginFrame,
  type PluginClient,
} from "@/plugin-sdk";

/** The Frame currently mounted for this Plugin, by the host's frame id. */
const frames = new Map<string, MessagePort>();

/** The language the host last reported; replayed to every Frame that pings. */
let currentLanguage = "en";

/** Posts `message` to every mounted Frame. */
function broadcast(message: unknown): void {
  for (const port of frames.values()) port.postMessage(message);
}

/** Sets the language and forwards it to every open Frame. */
function setLanguage(language: string): void {
  currentLanguage = language;
  broadcast({ kind: "lang", lang: language });
}

/** One host Frame handoff: keep its port and answer its messages. */
function keepFrame(frame: PluginFrame): void {
  frames.set(frame.id, frame.port);
  frame.port.onmessage = (event: MessageEvent) => {
    const data = event.data as { kind?: unknown } | null;
    if (data !== null && typeof data === "object") {
      if (data.kind === "ping") {
        frame.port.postMessage({ kind: "pong", lang: currentLanguage });
        return;
      }
      if (data.kind === "navigate") {
        // The Frame navigates itself; nothing more to do here.
        return;
      }
    }
  };
  frame.port.start();
}

/** The `embed` page: a Remote UI tree that mounts the kit Frame. */
function Embed() {
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Embedded frame page</ui.Heading>
      <ui.Text>A kit Frame inside a Remote UI page.</ui.Text>
      <ui.Frame src="ui/embed.html" title="Embedded frame" />
    </ui.View>
  );
}

/** Answers the host's `command.run`: the two self-navigation probes. */
async function runCommand(client: PluginClient, params: unknown): Promise<null> {
  const { id } = (params ?? {}) as { id?: string };
  if (id === "navigateData") {
    broadcast({ kind: "navigate", target: "data" });
  } else if (id === "navigateBlob") {
    broadcast({ kind: "navigate", target: "blob" });
  }
  await client.notifications.show({ variant: "info", message: `frame ran ${id ?? "unknown"}` });
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
    client.onFrame(keepFrame);
    servePluginUi(client, {
      pages: { embed: Embed },
      onHostRequest: (method, params) => {
        if (method === "health.check") return "pong";
        if (method === PLUGIN_COMMAND_RUN_REQUEST) return runCommand(client, params);
        throw new Error(`No handler for ${method}`);
      },
    });
    // The language path (D7): the current value at start, then every change. A
    // Frame that mounts later pings and gets the latest value, so a change the
    // Worker saw while no Frame was open is never lost.
    client.on("language.changed", (payload) => {
      setLanguage(payload.language);
    });
    client.language
      .get()
      .then((result) => {
        currentLanguage = result.language;
      })
      .catch(() => {});
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
