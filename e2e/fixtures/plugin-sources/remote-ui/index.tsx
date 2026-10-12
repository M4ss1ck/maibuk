// The remote-ui fixture Plugin (issue #446): the UI lane's Plugin page over the
// SDK's Worker Remote UI entry. Its Panel draws the kit (a heading, a search
// field, a counter button) and one element the kit never declares, so a spec can
// prove the host renders the tree, keeps typing host-owned, and stops the Plugin
// when a declaration leaves the UI kit.
//
// Built from this source into e2e/.output/plugins/remote-ui by the E2E global
// setup; the bundle is never committed. The Worker attaches through
// `servePluginUi` from the Worker entry, which installs the Remote DOM polyfill,
// so that import stays first among the SDK imports.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { createRemoteElement } from "@remote-dom/core/elements";
import { type ComponentType, useState } from "react";
import { createPluginClient, ui } from "@/plugin-sdk";

// One tag the host UI kit does not declare, defined once so React has a real
// custom element to render. The host's connection validator refuses it and
// stops the Plugin with `remote-ui-limit`.
if (typeof customElements !== "undefined" && customElements.get("maibuk-evil") === undefined) {
  customElements.define("maibuk-evil", createRemoteElement({}));
}

// JSX needs a component, not an intrinsic tag, for a hyphenated element name.
const Evil = "maibuk-evil" as unknown as ComponentType<Record<string, unknown>>;

function Panel() {
  const [value, setValue] = useState("");
  const [runs, setRuns] = useState(0);
  const [broken, setBroken] = useState(false);

  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Remote UI fixture</ui.Heading>
      <ui.TextField
        label="Search"
        value={value}
        onInput={(event) => setValue(event.detail)}
        onChange={(event) => setValue(event.detail)}
      />
      <ui.Text>{`Searching: ${value}`}</ui.Text>
      <ui.Button onPress={() => setRuns((count) => count + 1)}>Run</ui.Button>
      <ui.Text>{`Runs: ${runs}`}</ui.Text>
      <ui.Button onPress={() => setBroken(true)}>Break</ui.Button>
      {broken ? <Evil /> : null}
    </ui.View>
  );
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
      pages: { panel: Panel },
      onHostRequest: (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
