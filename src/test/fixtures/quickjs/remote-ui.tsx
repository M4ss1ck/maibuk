/**
 * The QuickJS runner's Remote UI harness Plugin (#516). It is a real Plugin
 * built from the real SDK (`@/plugin-sdk/worker-ui`), so the runner suite draws
 * exactly the bytes a shipped plugin draws. On the init event it takes the SDK
 * port, serves one page (`main`) and one Settings row body (`threshold`) through
 * the Worker's Remote DOM polyfill entry, then signals ready over the scope.
 *
 * This file is a Plugin source, not app code: it runs inside the QuickJS VM,
 * where `globalThis` is the worker scope and `@/plugin-sdk/worker-ui` installs
 * the Remote DOM polyfill.
 */

// The Worker entry installs the Remote DOM polyfill, so it stays first among
// the SDK imports: `@/plugin-sdk` touches `HTMLElement` when it is evaluated.
import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { useState } from "react";
import { PLUGIN_READY_MESSAGE, createPluginClient, ui } from "@/plugin-sdk";

/** The worker global surface this Plugin uses, without the DOM's Window types. */
interface RemoteUiScope {
  onmessage: ((event: { data: unknown; ports: readonly MessagePort[] }) => void) | null;
  postMessage(data: unknown): void;
}

const scope = globalThis as unknown as RemoteUiScope;

/** The page the suite mounts and drives by keyboard. */
function MainPage() {
  const [value, setValue] = useState("");
  const [runs, setRuns] = useState(0);
  return (
    <>
      <ui.Heading>Find</ui.Heading>
      <ui.TextField
        label="Search"
        value={value}
        onInput={(event) => setValue(event.detail)}
        onChange={(event) => setValue(event.detail)}
      />
      <ui.Text>{`You typed: ${value}`}</ui.Text>
      <ui.Button onPress={() => setRuns((count) => count + 1)}>Go</ui.Button>
      <ui.Text>{`Runs: ${runs}`}</ui.Text>
    </>
  );
}

/** The Settings row body the suite mounts and drives by keyboard. */
function ThresholdRow() {
  const [on, setOn] = useState(false);
  return (
    <ui.Switch
      label="Threshold"
      isSelected={on}
      onChange={(event) => setOn(event.detail)}
    />
  );
}

/**
 * A page that updates two states in one handler, so one commit produces two
 * text mutations that must travel in one flush batch (the 16 ms coalescing the
 * runner has to preserve).
 */
function BatchedPage() {
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  return (
    <>
      <ui.Button
        onPress={() => {
          setLeft((count) => count + 1);
          setRight((count) => count + 1);
        }}
      >
        Bump
      </ui.Button>
      <ui.Text>{`left:${left}`}</ui.Text>
      <ui.Text>{`right:${right}`}</ui.Text>
    </>
  );
}

scope.onmessage = (event) => {
  const port = event.ports[0];
  if (port === undefined) return;
  const client = createPluginClient(port);
  servePluginUi(client, {
    pages: { main: MainPage, batched: BatchedPage },
    settingsRows: { threshold: ThresholdRow },
    onHostRequest: (method) => {
      if (method === "health.check") return "pong";
      throw new Error(`No handler for ${method}`);
    },
  });
  scope.postMessage(PLUGIN_READY_MESSAGE);
};
