/**
 * The Frame shim, called directly in jsdom (#454 unit 2). It is the code the
 * Frame document runs; these tests drive it through a fake window so the
 * message guard, the in-frame blob URLs, the CSS/HTML rewriting, the frozen
 * `window.maibuk`, the token custom properties, and the one `frame-ready` post
 * are all proven without a browser.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FRAME_READY_MESSAGE, frameShim } from "@/features/plugins/frame";

const encoder = new TextEncoder();

interface ShimFile {
  path: string;
  type: string;
  bytes: Uint8Array;
}

function file(path: string, type: string, source: string | Uint8Array): ShimFile {
  return { path, type, bytes: typeof source === "string" ? encoder.encode(source) : source };
}

interface FakeWindow {
  parent: FakeWindow;
  document: Document;
  addEventListener: (type: string, listener: (event: MessageEvent) => void) => void;
  postMessage: (message: unknown, targetOrigin: string) => void;
}

interface Harness {
  win: FakeWindow;
  listeners: Array<(event: MessageEvent) => void>;
  posted: unknown[];
}

function makeWindow(): Harness {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const posted: unknown[] = [];
  const win = {
    parent: null as unknown as FakeWindow,
    document,
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === "message") listeners.push(listener);
    },
    postMessage: (message: unknown) => {
      posted.push(message);
    },
  };
  win.parent = win;
  return { win, listeners, posted };
}

function dispatch(harness: Harness, data: unknown, ports: MessagePort[] = [], source?: unknown): void {
  const event = { source: source ?? harness.win, data, ports } as unknown as MessageEvent;
  for (const listener of harness.listeners) listener(event);
}

let blobs: Map<string, Blob>;
let counter: number;

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.documentElement.removeAttribute("style");
  blobs = new Map();
  counter = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      const url = `blob:frame/${counter++}`;
      blobs.set(url, blob);
      return url;
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => {} });
});

describe("frameShim()", () => {
  it("ignores a message that does not come from the parent window", () => {
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    const foreign = makeWindow().win;
    dispatch(
      harness,
      { kind: "frame-load", html: "ui/index.html", files: [], tokens: {} },
      [],
      foreign
    );
    expect(document.body.innerHTML).toBe("");
    expect(harness.posted).toEqual([]);
    expect((harness.win as { maibuk?: unknown }).maibuk).toBeUndefined();
  });

  it("ignores a message kind it does not handle", () => {
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    dispatch(harness, { kind: "frame-ready" });
    dispatch(harness, { kind: "frame-tokens", tokens: { "--x": "1" } });
    expect(harness.posted).toEqual([]);
    expect(document.documentElement.style.getPropertyValue("--x")).toBe("");
  });

  it("on frame-load builds in-frame blob URLs and rewrites the document", async () => {
    const html = [
      "<!doctype html><html><head>",
      '<link rel="stylesheet" href="styles.css">',
      "</head><body>",
      '<img src="photo.png" alt="photo">',
      '<img src="data:image/png;base64,AAAA" alt="inline">',
      '<img src="missing.png" alt="gone">',
      '<script src="app.js"></script>',
      "<script>window.ranFromFrame = true;</script>",
      "</body></html>",
    ].join("");
    const files = [
      file("ui/index.html", "text/html", html),
      file(
        "ui/styles.css",
        "text/css",
        'body { background: url("photo.png"); } .x { background: url(https://example.test/x.png); }'
      ),
      file("ui/app.js", "text/javascript", "export const a = 1;"),
      file("ui/photo.png", "image/png", new Uint8Array([1, 2, 3])),
    ];

    const channel = new MessageChannel();
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    dispatch(
      harness,
      {
        kind: "frame-load",
        html: "ui/index.html",
        files,
        tokens: { "--maibuk-color-primary": "red" },
      },
      [channel.port1]
    );

    const photo = document.querySelector("body img[alt='photo']");
    expect(photo?.getAttribute("src")).toMatch(/^blob:frame\//);
    const inline = document.querySelector("body img[alt='inline']");
    expect(inline?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
    const gone = document.querySelector("body img[alt='gone']");
    expect(gone?.hasAttribute("src")).toBe(false);

    const link = document.querySelector('head link[rel="stylesheet"]');
    const cssUrl = link?.getAttribute("href") ?? "";
    expect(cssUrl).toMatch(/^blob:frame\//);
    const css = await blobs.get(cssUrl)?.text();
    expect(css).toContain(`url("${photo?.getAttribute("src")}")`);
    // A remote CSS url() is left as written: it fails closed under the CSP.
    expect(css).toContain("url(https://example.test/x.png)");

    const scripts = document.querySelectorAll("body script");
    expect(scripts).toHaveLength(2);
    expect(scripts[0].getAttribute("src")).toMatch(/^blob:frame\//);
    expect(scripts[1].textContent).toContain("window.ranFromFrame = true;");

    const api = (harness.win as unknown as { maibuk: { port: MessagePort | null } }).maibuk;
    expect(Object.isFrozen(api)).toBe(true);
    expect(api.port).toBe(channel.port1);
    expect(document.documentElement.style.getPropertyValue("--maibuk-color-primary")).toBe("red");

    expect(harness.posted).toEqual([{ kind: FRAME_READY_MESSAGE.kind }]);
  });

  it("applies a later frame-theme message to the custom properties", () => {
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    dispatch(harness, {
      kind: "frame-load",
      html: "ui/index.html",
      files: [file("ui/index.html", "text/html", "<html><body></body></html>")],
      tokens: { "--maibuk-color-primary": "red" },
    });
    dispatch(harness, { kind: "frame-theme", tokens: { "--maibuk-color-primary": "blue" } });
    expect(document.documentElement.style.getPropertyValue("--maibuk-color-primary")).toBe("blue");
  });

  it("applies frame-theme before any load", () => {
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    dispatch(harness, { kind: "frame-theme", tokens: { "--maibuk-font-sans": "Inter" } });
    expect(document.documentElement.style.getPropertyValue("--maibuk-font-sans")).toBe("Inter");
  });

  it("ignores a second frame-load", () => {
    const harness = makeWindow();
    frameShim(harness.win as unknown as Window);
    dispatch(harness, {
      kind: "frame-load",
      html: "ui/index.html",
      files: [file("ui/index.html", "text/html", "<html><body><p id='first'></p></body></html>")],
      tokens: {},
    });
    dispatch(harness, {
      kind: "frame-load",
      html: "ui/index.html",
      files: [file("ui/index.html", "text/html", "<html><body><p id='second'></p></body></html>")],
      tokens: {},
    });
    expect(document.querySelector("#first")).not.toBeNull();
    expect(document.querySelector("#second")).toBeNull();
    expect(harness.posted).toEqual([{ kind: FRAME_READY_MESSAGE.kind }]);
  });
});
