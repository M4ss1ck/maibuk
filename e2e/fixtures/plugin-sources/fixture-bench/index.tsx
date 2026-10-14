// The bench fixture Plugin (issue #448): the E2E workload the `bench:plugins`
// and `bench:frames` lanes measure. Its `echo` page renders, through Remote UI,
// a host-owned text field whose every keystroke the Plugin echoes back and a
// 1,000-row table, so a spec (and the bench) can drive typing and a large tree.
// While a Chapter editor is focused it paints ~500 highlight ranges (every Nth
// word) and refreshes them on content change, debounced 300 ms like spell check.
//
// Built from this source into e2e/.output/plugins/fixture-bench by the E2E
// global setup; the bundle is never committed. The Worker entry installs the
// Remote DOM polyfill, so `servePluginUi` stays first among the SDK imports,
// exactly as the remote-ui and fixture-everything fixtures do.

import { servePluginUi } from "@/plugin-sdk/worker-ui";
import { memo, useState } from "react";
import { createPluginClient, ui, type PluginClient } from "@/plugin-sdk";

/** The row labels the table renders, "Row 1".."Row 1000". */
const ROWS = Array.from({ length: 1000 }, (_, index) => `Row ${index + 1}`);

/** The ~500 ranges the highlight sweep spreads over the Chapter text (#401). */
const HIGHLIGHT_RANGE_TARGET = 500;

/** How long a burst of Chapter edits coalesces before the highlights refresh. */
const HIGHLIGHT_DEBOUNCE_MS = 300;

/** One plain-text offset range `editor.setHighlights` accepts. */
interface HighlightRange {
  from: number;
  to: number;
  label?: string;
}

/**
 * `count` non-overlapping ranges on whole words spread evenly through `text`,
 * the shape Echoes hands `editor.setHighlights` (the bench's own
 * `spreadHighlightRanges`): every Nth word, ~500 total.
 */
function spreadRanges(text: string, count = HIGHLIGHT_RANGE_TARGET): HighlightRange[] {
  const words: { start: number; end: number }[] = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    words.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(text);
  }
  const ranges: HighlightRange[] = [];
  const step = Math.max(1, Math.floor(words.length / count));
  for (let i = 0; i < words.length && ranges.length < count; i += step) {
    ranges.push({ from: words[i].start, to: words[i].end, label: `bench ${ranges.length + 1}` });
  }
  return ranges;
}

/**
 * The 1,000-row table. Memoized with no props so typing in the echo field never
 * re-renders it: a fresh table on every keystroke would send ~2,000 Remote UI
 * records in one batch and the host would stop the Plugin with
 * `remote-ui-limit` (`PLUGIN_UI_LIMITS.maxRecordsPerBatch`).
 */
const Rows = memo(function Rows() {
  return (
    <ui.Table label="Bench rows" columns={[{ value: "row", label: "Row" }]}>
      {ROWS.map((row) => (
        <ui.TableRow key={row} cells={[{ value: "row", label: row }]} />
      ))}
    </ui.Table>
  );
});

/** The `echo` page: a host-owned text field the Plugin echoes, and 1,000 rows. */
function Echo() {
  const [value, setValue] = useState("");
  return (
    <ui.View direction="column" gap="md">
      <ui.Heading>Bench echo</ui.Heading>
      <ui.TextField
        label="Echo input"
        value={value}
        onInput={(event) => setValue(event.detail)}
        onChange={(event) => setValue(event.detail)}
      />
      <ui.Text>{`echo:${value}`}</ui.Text>
      <Rows />
    </ui.View>
  );
}

/**
 * Paints the focused Chapter's highlights and keeps them fresh. The Plugin
 * re-highlights when a different editor takes focus and, debounced 300 ms like
 * spell check, when the focused editor's content changes.
 */
async function watchFocusedEditor(client: PluginClient): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = async (): Promise<void> => {
    const content = await client.editor.getContent();
    if (content.status !== "ok") return;
    await client.editor.setHighlights({
      kind: "info",
      ranges: spreadRanges(content.content.text),
    });
  };

  await client.on("editor.focusChanged", (payload) => {
    if (payload.entity === null) return;
    void refresh();
  });
  await client.on("editor.contentChanged", () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void refresh();
    }, HIGHLIGHT_DEBOUNCE_MS);
  });
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
      pages: { echo: Echo },
      onHostRequest: (method) => {
        if (method === "health.check") return "pong";
        throw new Error(`No handler for ${method}`);
      },
    });
    void watchFocusedEditor(client).catch((error) => {
      console.error("fixture-bench: editor highlights unavailable", error);
    });
    self.postMessage({ kind: "maibuk:plugin-ready" });
  };
}
