import "@remote-dom/core/polyfill";
import "@remote-dom/react/polyfill";
import { ThreadWebWorker } from "@quilted/threads";
import { BatchingRemoteConnection, RemoteRootElement } from "@remote-dom/core/elements";
import { createRemoteComponent } from "@remote-dom/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UIListItem, UIText, UITextField } from "./elements";

customElements.define("ui-text-field", UITextField);
customElements.define("ui-text", UIText);
customElements.define("ui-list-item", UIListItem);
customElements.define("remote-root", RemoteRootElement);

const TextField = createRemoteComponent("ui-text-field", UITextField, { eventProps: { onInput: { event: "input" } } });
const Text = createRemoteComponent("ui-text", UIText);
const ListItem = createRemoteComponent("ui-list-item", UIListItem);

function App({ rows }: { rows: number }) {
  const [value, setValue] = useState("");
  return (
    <>
      <TextField label="Search" value={value} onInput={(e: any) => setValue(e.detail)} />
      <Text>{String(value.length)}</Text>
      {Array.from({ length: rows }, (_, i) => (
        <ListItem key={i} label={`Row ${i}: ${value.length} ${value.slice(-3)}`} />
      ))}
    </>
  );
}

ThreadWebWorker.self({
  exports: {
    async render(connection: any, rows: number) {
      const root = document.createElement("remote-root") as any;
      root.connect(new BatchingRemoteConnection(connection));
      createRoot(root).render(<App rows={rows} />);
    },
  },
});
