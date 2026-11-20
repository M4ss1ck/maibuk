// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPastedImage } from "@/lib/pasted-image";

const { mockReadCopiedImageFile, runtime } = vi.hoisted(() => ({
  mockReadCopiedImageFile: vi.fn(),
  runtime: { desktop: true },
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get IS_DESKTOP() {
    return runtime.desktop;
  },
  getClipboard: async () => ({
    readText: vi.fn(),
    writeText: vi.fn(),
    readCopiedImageFile: mockReadCopiedImageFile,
  }),
}));

// jsdom has no DataTransfer: this keeps the shapes the helper reads.
function pasteEvent({
  files = [],
  items = [],
  data = {},
}: {
  files?: File[];
  items?: DataTransferItem[];
  data?: Record<string, string>;
} = {}): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      items,
      // A real event lists "Files" whenever it carries one.
      types: [...(files.length || items.length ? ["Files"] : []), ...Object.keys(data)],
      getData: (type: string) => data[type] ?? "",
    },
  });
  return event;
}

const png = () => new File(["png"], "cat.png", { type: "image/png" });

describe("claimPastedImage", () => {
  beforeEach(() => {
    mockReadCopiedImageFile.mockReset();
    runtime.desktop = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("claims the image file the event carries", async () => {
    const file = png();
    const event = pasteEvent({ files: [file] });

    const claim = claimPastedImage(event, { capture: true });

    expect(event.defaultPrevented).toBe(true);
    await expect(claim).resolves.toBe(file);
  });

  it("finds the image in the items when files is empty", async () => {
    const file = png();
    const item = { kind: "file", type: "image/png", getAsFile: () => file } as DataTransferItem;

    await expect(claimPastedImage(pasteEvent({ items: [item] }), { capture: true })).resolves.toBe(
      file
    );
  });

  it("leaves a paste of text or html untouched", () => {
    const event = pasteEvent({ data: { "text/plain": "hi", "text/html": "<b>hi</b>" } });

    expect(claimPastedImage(event, { capture: true })).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves a non-image file untouched", () => {
    const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });

    expect(claimPastedImage(pasteEvent({ files: [pdf] }), { capture: true })).toBeNull();
  });

  // WebKitGTK: a file-manager copy reaches the page as one empty text/uri-list,
  // and the page cannot read the file it names.
  it("asks the platform for a file a file manager copied", async () => {
    const copied = new Blob(["png"], { type: "image/png" });
    mockReadCopiedImageFile.mockResolvedValue(copied);
    const event = pasteEvent({ data: { "text/uri-list": "" } });

    const claim = claimPastedImage(event, { capture: false });

    // Claimed before WebKit inserts a file:// link in its place.
    expect(event.defaultPrevented).toBe(true);
    await expect(claim).resolves.toBe(copied);
  });

  it("leaves a copied file to the page on web, where nothing can read it", () => {
    runtime.desktop = false;
    const event = pasteEvent({ data: { "text/uri-list": "" } });

    expect(claimPastedImage(event, { capture: true })).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(mockReadCopiedImageFile).not.toHaveBeenCalled();
  });

  it("leaves a uri-list that carries a link untouched", () => {
    const event = pasteEvent({ data: { "text/uri-list": "https://example.com" } });

    expect(claimPastedImage(event, { capture: true })).toBeNull();
    expect(mockReadCopiedImageFile).not.toHaveBeenCalled();
  });

  describe("an event that carries no data (WebKitGTK's image copy)", () => {
    // WebKitGTK pastes a copied picture natively as <img src="blob:...">.
    function nativePaste(src: string) {
      const sink = document.activeElement as HTMLElement;
      const img = document.createElement("img");
      img.setAttribute("src", src);
      sink.append(img);
    }

    it("lets the paste land natively in a hidden field and reads its image", async () => {
      vi.useFakeTimers();
      const picture = new Blob(["png"], { type: "image/png" });
      const fetchMock = vi.fn(async () => ({ blob: async () => picture }));
      vi.stubGlobal("fetch", fetchMock);
      const button = document.createElement("button");
      document.body.append(button);
      button.focus();
      const event = pasteEvent();

      const claim = claimPastedImage(event, { capture: true });

      // The default action is what fills the field, so it must run.
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement?.getAttribute("contenteditable")).toBe("true");
      nativePaste("blob:http://localhost/1");
      await vi.runAllTimersAsync();

      await expect(claim).resolves.toBe(picture);
      expect(fetchMock).toHaveBeenCalledWith("blob:http://localhost/1");
      expect(document.querySelector("[contenteditable]")).toBeNull();
      expect(document.activeElement).toBe(button);
    });

    it("resolves null when the native paste brings no image", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const claim = claimPastedImage(pasteEvent(), { capture: true });
      (document.activeElement as HTMLElement).append("plain words");
      await vi.runAllTimersAsync();

      await expect(claim).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(document.querySelector("[contenteditable]")).toBeNull();
    });

    it("rejects when the pasted image cannot be read", async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Load failed");
        })
      );

      const claim = claimPastedImage(pasteEvent(), { capture: true });
      nativePaste("blob:http://localhost/gone");
      const settled = expect(claim).rejects.toThrow("Load failed");
      await vi.runAllTimersAsync();

      await settled;
      expect(document.querySelector("[contenteditable]")).toBeNull();
    });

    it("is left to an editor that captures the native paste itself", () => {
      const event = pasteEvent();

      expect(claimPastedImage(event, { capture: false })).toBeNull();
      expect(document.querySelector("[contenteditable]")).toBeNull();
    });
  });
});
