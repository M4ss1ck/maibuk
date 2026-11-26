// Shelf paint (issue #945, #917's budget): how long the Reader Frame takes to
// draw a 500-Document Shelf, from the Worker's `open` message to the first
// frame painted after the grid's cells exist. The Frame is the built
// `shelf.html` and `reader.js`, served from Reader's source folder after the runner builds its bundle, with
// a MessageChannel standing in for the host's Frame port, so the number is the
// Frame's own work: the query, the virtual window, and the first layout and
// paint. Two warm-up loads are thrown away, then each sample is a fresh page.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/test";
import { benchOut } from "./support";

const WARM_UPS = 2;
const SAMPLES = Number(process.env.READER_BENCH_SAMPLES ?? 10);
const ORIGIN = "https://reader-bench.local";
/** Reader's Frame files; the runner builds `reader.js` into this folder first. */
function frameDir(): string {
  return resolve("plugins/maibuk-reader/assets/ui");
}

/** The Worker's `open` message the runner wrote (see `shelf-open.ts`). */
function openMessage(): { shelf: { entries: unknown[] } } {
  const path = process.env.READER_BENCH_SHELF_OPEN;
  if (!path) throw new Error("READER_BENCH_SHELF_OPEN is required; run `pnpm bench:reader`");
  return JSON.parse(readFileSync(path, "utf8"));
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
    const ready = await Promise.race([
      bench.ready.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000)),
    ]);
    if (!ready) throw new Error("the Shelf Frame never posted ready");
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const started = performance.now();
    bench.port.postMessage(message);
    const deadline = started + 30_000;
    while (document.querySelectorAll('#shelf-root [role="gridcell"]').length === 0) {
      if (performance.now() > deadline) throw new Error("the Shelf drew no cell in 30 s");
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
  const open = openMessage();
  const documents = open.shelf.entries.length;

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
  expect(cells).toBeLessThan(documents);
  writeFileSync(
    resolve(benchOut(), "shelf.json"),
    `${JSON.stringify({ documents, warmUps: WARM_UPS, paintMs, cells }, null, 1)}\n`
  );
});
