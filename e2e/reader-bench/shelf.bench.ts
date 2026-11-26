// Shelf paint (issue #945, #917's budget): how long the Reader Frame takes to
// draw a 500-Document Shelf, from the Worker's `open` message to the first
// frame painted after the grid's cells exist. The Frame is the built
// `shelf.html` and `reader.js`, served from the web build's Plugin folder, with
// a MessageChannel standing in for the host's Frame port, so the number is the
// Frame's own work: the query, the virtual window, and the first layout and
// paint. Two warm-up loads are thrown away, then each sample is a fresh page.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { frameShelfState, frameShelfLabels } from "../../plugins/maibuk-reader/frame-shelf";
import { frameLabels } from "../../plugins/maibuk-reader/session";
import type { ShelfEntry } from "../../plugins/maibuk-reader/shelf";
import { expect, test } from "../support/test";
import { benchOut } from "./support";

const WARM_UPS = 2;
const SAMPLES = Number(process.env.READER_BENCH_SAMPLES ?? 10);
const DOCUMENTS = 500;
const ORIGIN = "https://reader-bench.local";
const FORMATS = ["pdf", "epub", "mobi", "azw3", "fb2", "cbz"] as const;

/** The web build's copy of the Frame files, or the source folder after `pnpm build:plugins`. */
function frameDir(): string {
  const built = resolve("dist/plugins/maibuk-reader/assets/ui");
  if (existsSync(join(built, "reader.js"))) return built;
  return resolve("plugins/maibuk-reader/assets/ui");
}

/** 500 Shelf rows with every status, format, and a spread of dates and progress. */
function shelfRows(): ShelfEntry[] {
  return Array.from({ length: DOCUMENTS }, (_, index) => ({
    id: `bench-${index}`,
    grant: `grant-${index}`,
    fingerprint: `${index}:bench`,
    title: `Bench Document ${index + 1}`,
    author: `Author ${(index % 37) + 1}`,
    format: FORMATS[index % FORMATS.length],
    lastReadAt: 1_000_000 - index,
    addedAt: 500_000 + ((index * 7919) % DOCUMENTS),
    progress: index % 5 === 0 ? null : { fraction: (index % 100) / 100 },
    state: "ok",
  }));
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
};

/** Serves the Frame files under a fake origin and hands the page its Frame port. */
async function prepare(page: Page): Promise<void> {
  const dir = frameDir();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/+/, "");
    const path = join(dir, name);
    if (!existsSync(path)) return route.fulfill({ status: 404, body: "" });
    await route.fulfill({
      status: 200,
      contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      body: readFileSync(path),
    });
  });
  await page.addInitScript(() => {
    const channel = new MessageChannel();
    const ready = new Promise<void>((resolve) => {
      channel.port2.onmessage = (event) => {
        if ((event.data as { kind?: string })?.kind === "ready") resolve();
      };
    });
    const host = window as unknown as {
      maibuk: { port: MessagePort };
      __bench: { port: MessagePort; ready: Promise<void> };
    };
    host.maibuk = { port: channel.port1 };
    host.__bench = { port: channel.port2, ready };
  });
}

/** One load: open the Shelf with 500 rows and time it until the grid has painted. */
async function paintOnce(page: Page, open: unknown): Promise<{ paintMs: number; cells: number }> {
  await page.goto(`${ORIGIN}/shelf.html`);
  return page.evaluate(async (message) => {
    const bench = (window as unknown as { __bench: { port: MessagePort; ready: Promise<void> } })
      .__bench;
    await bench.ready;
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const started = performance.now();
    bench.port.postMessage(message);
    while (document.querySelectorAll('#shelf-root [role="gridcell"]').length === 0) {
      await frame();
    }
    // The frame after the cells exist is the one that paints them.
    await frame();
    return {
      paintMs: performance.now() - started,
      cells: document.querySelectorAll('#shelf-root [role="gridcell"]').length,
    };
  }, open);
}

test("paints a 500-Document Shelf", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await prepare(page);
  const open = {
    kind: "open",
    view: "shelf",
    entry: null,
    position: null,
    settings: { fontSize: 100, lineWidth: "medium", pdfFit: "width", pdfLayout: "single" },
    size: 0,
    labels: frameLabels("en"),
    shelf: frameShelfState("en", shelfRows()),
    shelfLabels: frameShelfLabels("en"),
    language: "en",
    appearance: { colorScheme: "light", eink: false },
  };

  const paintMs: number[] = [];
  let cells = 0;
  for (let run = 0; run < WARM_UPS + SAMPLES; run++) {
    const sample = await paintOnce(page, open);
    if (run < WARM_UPS) continue;
    paintMs.push(sample.paintMs);
    cells = sample.cells;
  }
  // Virtualized: far fewer cells than Documents are drawn.
  expect(cells).toBeGreaterThan(0);
  expect(cells).toBeLessThan(DOCUMENTS);
  writeFileSync(
    resolve(benchOut(), "shelf.json"),
    `${JSON.stringify({ documents: DOCUMENTS, warmUps: WARM_UPS, paintMs, cells }, null, 1)}\n`
  );
});
