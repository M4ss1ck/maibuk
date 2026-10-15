/**
 * The Frame document and load message (ADR 0021, D4, #454 unit 2): the exact
 * CSP, the visible named iframe that can only run scripts, the MIME mapping,
 * and the one `frame-load` message built from the verified hashed folder.
 */

import { describe, expect, it } from "vitest";
import {
  FRAME_CSP,
  FRAME_DOCUMENT,
  FRAME_LOAD_MESSAGE,
  FRAME_READY_MESSAGE,
  FRAME_THEME_MESSAGE,
  FrameLoadError,
  buildFrameLoadMessage,
  createFrameElement,
  frameMimeType,
} from "@/features/plugins/frame";
import type { PluginFolderFile } from "@/features/plugins/types";

const encoder = new TextEncoder();

function file(path: string, source = ""): PluginFolderFile {
  return { path, bytes: encoder.encode(source) };
}

describe("the Frame CSP", () => {
  it("is the D4 policy exactly", () => {
    expect(FRAME_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"
    );
  });

  it("is carried in the host document with the shared message kinds", () => {
    expect(FRAME_DOCUMENT).toContain(`content="${FRAME_CSP}"`);
    for (const kind of [
      FRAME_LOAD_MESSAGE.kind,
      FRAME_THEME_MESSAGE.kind,
      FRAME_READY_MESSAGE.kind,
    ]) {
      expect(FRAME_DOCUMENT).toContain(kind);
    }
  });
});

describe("createFrameElement()", () => {
  it("is a visible, named frame that can only run scripts", () => {
    const element = createFrameElement(document, { title: "Plugin custom UI" });
    expect(element.getAttribute("sandbox")).toBe("allow-scripts");
    expect(element.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(element.title).toBe("Plugin custom UI");
    expect(element.getAttribute("name")).toBeNull();
    expect(element.hasAttribute("aria-hidden")).toBe(false);
    expect(element.hasAttribute("inert")).toBe(false);
    expect(element.style.display).toBe("block");
    expect(element.srcdoc).toBe(FRAME_DOCUMENT);
  });
});

describe("frameMimeType()", () => {
  it("maps every loadable file kind to the MIME of its extension", () => {
    expect(frameMimeType("ui/index.html")).toBe("text/html");
    expect(frameMimeType("ui/legacy.htm")).toBe("text/html");
    expect(frameMimeType("ui/styles.css")).toBe("text/css");
    expect(frameMimeType("ui/app.js")).toBe("text/javascript");
    expect(frameMimeType("ui/app.mjs")).toBe("text/javascript");
    expect(frameMimeType("ui/logo.svg")).toBe("image/svg+xml");
    expect(frameMimeType("ui/photo.PNG")).toBe("image/png");
    expect(frameMimeType("ui/font.woff2")).toBe("font/woff2");
    expect(frameMimeType("ui/clip.mp4")).toBe("video/mp4");
    expect(frameMimeType("ui/track.mp3")).toBe("audio/mpeg");
  });

  it("never loads the manifest or an unknown kind", () => {
    expect(frameMimeType("manifest.json")).toBeNull();
    expect(frameMimeType("ui/manifest.json")).toBeNull();
    expect(frameMimeType("ui/index.ts")).toBeNull();
    expect(frameMimeType("ui/README")).toBeNull();
  });
});

describe("buildFrameLoadMessage()", () => {
  const files = [
    file("manifest.json", "{}"),
    file("ui/index.html", "<html></html>"),
    file("ui/styles.css", "body {}"),
    file("ui/app.js", "export const a = 1;"),
    file("ui/photo.png"),
    file("ui/font.woff2"),
    file("ui/notes.md", "# notes"),
  ];

  it("keeps the loadable kinds with the MIME of their extension, never the manifest", () => {
    const message = buildFrameLoadMessage(files, "ui/index.html");
    expect(message.kind).toBe(FRAME_LOAD_MESSAGE.kind);
    expect(message.html).toBe("ui/index.html");
    const byPath = new Map(message.files.map((entry) => [entry.path, entry.type]));
    expect(byPath.get("ui/index.html")).toBe("text/html");
    expect(byPath.get("ui/styles.css")).toBe("text/css");
    expect(byPath.get("ui/app.js")).toBe("text/javascript");
    expect(byPath.get("ui/photo.png")).toBe("image/png");
    expect(byPath.get("ui/font.woff2")).toBe("font/woff2");
    expect(byPath.has("manifest.json")).toBe(false);
    expect(byPath.has("ui/notes.md")).toBe(false);
  });

  it("carries the file bytes and the tokens, empty by default", () => {
    const message = buildFrameLoadMessage(files, "ui/index.html");
    const html = message.files.find((entry) => entry.path === "ui/index.html");
    expect(Array.from(html?.bytes ?? [])).toEqual(Array.from(encoder.encode("<html></html>")));
    expect(message.tokens).toEqual({});
    expect(
      buildFrameLoadMessage(files, "ui/index.html", { "--maibuk-color-primary": "red" }).tokens
    ).toEqual({ "--maibuk-color-primary": "red" });
  });

  it("refuses a frame path that is not an HTML file in the set", () => {
    expect(() => buildFrameLoadMessage(files, "ui/missing.html")).toThrow(FrameLoadError);
    expect(() => buildFrameLoadMessage(files, "ui/app.js")).toThrow(FrameLoadError);
  });
});
