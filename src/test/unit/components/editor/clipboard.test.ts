import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasRichFormatting,
  plainTextToHtml,
  readClipboardSnapshot,
  snapshotToPlainText,
} from "@/components/editor/clipboard";

describe("clipboard pure helpers", () => {
  it("detects rich formatting tags", () => {
    expect(hasRichFormatting("<p>plain</p>")).toBe(false);
    expect(hasRichFormatting("<strong>bold</strong>")).toBe(true);
    expect(hasRichFormatting("<ul><li>x</li></ul>")).toBe(true);
  });

  it("derives plain text, preferring text over html", () => {
    expect(snapshotToPlainText({ text: "hi", html: "<b>hi</b>", hasImage: false })).toBe("hi");
    expect(snapshotToPlainText({ text: "", html: "<b>bold</b>", hasImage: false })).toBe("bold");
    expect(snapshotToPlainText({ text: "", html: null, hasImage: true })).toBe("");
  });

  it("converts plain text to escaped, line-broken HTML", () => {
    expect(plainTextToHtml("a\nb")).toBe("<p>a<br>b</p>");
    expect(plainTextToHtml("p1\n\np2")).toBe("<p>p1</p><p>p2</p>");
    expect(plainTextToHtml("a < b & c")).toBe("<p>a &lt; b &amp; c</p>");
  });
});

describe("readClipboardSnapshot - navigator path", () => {
  const makeItem = (map: Record<string, string>) => ({
    types: Object.keys(map),
    getType: (type: string) => Promise.resolve(new Blob([map[type]], { type })),
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads html + plain text from navigator", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi
          .fn()
          .mockResolvedValue([makeItem({ "text/html": "<b>hi</b>", "text/plain": "hi" })]),
      },
    });
    const snap = await readClipboardSnapshot();
    expect(snap.text).toBe("hi");
    expect(snap.html).toBe("<b>hi</b>");
    expect(snap.hasImage).toBe(false);
  });

  it("detects image-only clipboards", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        read: vi.fn().mockResolvedValue([makeItem({ "image/png": "x" })]),
      },
    });
    const snap = await readClipboardSnapshot();
    expect(snap.hasImage).toBe(true);
    expect(snap.text).toBe("");
  });
});

describe("readClipboardSnapshot - Tauri fallback", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("falls back to the plugin when navigator throws", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { read: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    vi.doMock("@tauri-apps/plugin-clipboard-manager", () => ({
      readText: vi.fn().mockResolvedValue("from tauri"),
      readImage: vi.fn().mockRejectedValue(new Error("no image")),
    }));
    const { readClipboardSnapshot: read } = await import("@/components/editor/clipboard");
    const snap = await read();
    expect(snap.text).toBe("from tauri");
    expect(snap.html).toBeNull();
    expect(snap.hasImage).toBe(false);
  });
});
