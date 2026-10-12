// The remote-ui fixture Plugin (issues #446, #439): the UI lane's Plugin pages
// over the SDK's Worker Remote UI entry. `panel` draws part 1's kit (a heading,
// a search field, a counter button) and one element the kit never declares, so a
// spec can prove the host renders the tree, keeps typing host-owned, and stops
// the Plugin when a declaration leaves the UI kit. `gallery` draws part 2's kit
// (organization, overlays, feedback, and Plugin CSS) for the keyboard specs and
// the light/dark gallery screenshots.
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

/**
 * Plugin CSS, scoped by the host to this surface's own attribute. The selectors
 * are plain element names because a Plugin never learns a host component's
 * classes; the host rewrites each one under the surface.
 */
const GALLERY_CSS = `
th { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.08em }
caption { letter-spacing: 0.08em; text-transform: uppercase }
`;

function Gallery() {
  const [tab, setTab] = useState("overview");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [rowExpanded, setRowExpanded] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progress, setProgress] = useState(2);
  const [menuRun, setMenuRun] = useState("");

  return (
    <ui.Surface css={GALLERY_CSS}>
      <ui.Heading level={2}>Kit gallery</ui.Heading>
      <ui.Text tone="muted">Organization, overlays, feedback, and Plugin CSS.</ui.Text>

      <ui.Tabs
        label="Gallery sections"
        items={[
          { value: "overview", label: "Overview" },
          { value: "details", label: "Details" },
        ]}
        selectedKey={tab}
        onChange={(event) => setTab(event.detail)}
      >
        <ui.Text>{`Panel: ${tab}`}</ui.Text>
      </ui.Tabs>

      <ui.Disclosure
        label="Advanced options"
        isExpanded={disclosure}
        onExpandedChange={(event) => setDisclosure(event.detail)}
      >
        <ui.Text>Advanced options panel</ui.Text>
      </ui.Disclosure>

      <ui.Collection
        label="Chapters"
        selectionMode="single"
        selectedKeys={selected}
        onSelectionChange={(event) => setSelected([...event.detail])}
      >
        <ui.CollectionRow
          id="one"
          label="Chapter one"
          description="12 words"
          isExpandable
          isExpanded={rowExpanded}
          onExpandedChange={(event) => setRowExpanded(event.detail)}
        >
          <ui.Text>Chapter one summary</ui.Text>
        </ui.CollectionRow>
        <ui.CollectionRow
          id="two"
          label="Chapter two"
          menuItems={[
            { value: "rename", label: "Rename" },
            { value: "delete", label: "Delete" },
          ]}
          onMenuAction={(event) => setMenuRun(event.detail)}
        />
        <ui.CollectionRow id="three" label="Chapter three" />
      </ui.Collection>
      <ui.Status>{menuRun ? `Menu action: ${menuRun}` : "No menu action yet"}</ui.Status>

      <ui.Table
        label="Statistics"
        columns={[
          { value: "name", label: "Name" },
          { value: "words", label: "Words" },
        ]}
      >
        <ui.TableRow
          cells={[
            { value: "name", label: "Chapter one" },
            { value: "words", label: "1200" },
          ]}
        />
        <ui.TableRow
          cells={[
            { value: "name", label: "Chapter two" },
            { value: "words", label: "980" },
          ]}
        />
      </ui.Table>

      <ui.ProgressBar label="Exporting" value={progress} maxValue={4} />
      <ui.Button variant="secondary" onPress={() => setProgress((value) => Math.min(4, value + 1))}>
        Advance
      </ui.Button>
      <ui.Status tone="success">Export finished</ui.Status>
      <ui.EmptyState title="No notes yet" description="Notes you add appear here." />

      <ui.View direction="row" gap="sm" wrap>
        <ui.Button onPress={() => setModalOpen(true)}>Open modal</ui.Button>
        <ui.Button variant="destructive" onPress={() => setConfirmOpen(true)}>
          Delete chapter
        </ui.Button>
        <ui.Popover label="More options">
          <ui.Text>Popover body</ui.Text>
        </ui.Popover>
        <ui.Tooltip content="Saved locally">
          <ui.Button variant="ghost">Tooltip target</ui.Button>
        </ui.Tooltip>
      </ui.View>

      <ui.Modal title="Chapter details" isOpen={modalOpen} onOpenChange={() => {}}>
        <ui.Text>Modal body</ui.Text>
      </ui.Modal>
      <ui.ConfirmDialog
        title="Delete chapter?"
        description="This cannot be undone."
        isDestructive
        isOpen={confirmOpen}
        onConfirm={() => setConfirmOpen(false)}
        onOpenChange={(event) => setConfirmOpen(event.detail)}
      />
    </ui.Surface>
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
      pages: { panel: Panel, gallery: Gallery },
      onHostRequest: (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      },
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
