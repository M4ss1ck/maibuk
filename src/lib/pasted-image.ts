import { IS_DESKTOP, getClipboard } from "@/lib/platform";

// ProseMirror's capturePaste waits the same 50ms for a native paste to land.
const NATIVE_PASTE_SETTLE_MS = 50;

function imageFileOn(data: DataTransfer): File | null {
  const file = Array.from(data.files).find((candidate) => candidate.type.startsWith("image/"));
  if (file) return file;
  const itemFile = Array.from(data.items)
    .map((item) => (item.kind === "file" ? item.getAsFile() : null))
    .find((candidate): candidate is File => candidate?.type.startsWith("image/") ?? false);
  return itemFile ?? null;
}

// The shape WebKitGTK gives a file-manager copy: one empty text/uri-list.
function isCopiedFile(data: DataTransfer): boolean {
  const types = Array.from(data.types ?? []);
  return types.length === 1 && types[0] === "text/uri-list" && data.getData("text/uri-list") === "";
}

// WebKitGTK hands a copied picture to the page only through a native paste
// into an editable element, as <img src="blob:...">. The field is focused while
// the event is still dispatching, so the default action fills it.
async function captureNativePaste(): Promise<Blob | null> {
  const previous = document.activeElement;
  const sink = document.createElement("div");
  sink.setAttribute("contenteditable", "true");
  sink.setAttribute("aria-hidden", "true");
  sink.tabIndex = -1;
  sink.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;overflow:hidden";
  document.body.append(sink);
  sink.focus({ preventScroll: true });

  await new Promise((resolve) => setTimeout(resolve, NATIVE_PASTE_SETTLE_MS));
  const src = sink.querySelector("img")?.getAttribute("src");
  sink.remove();
  if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
    previous.focus({ preventScroll: true });
  }
  if (!src) return null;

  const blob = await (await fetch(src)).blob();
  return blob.type.startsWith("image/") ? blob : null;
}

/**
 * Claims a paste that brings an image, from any source the platform delivers:
 * the event's own image file (browsers), a picture WebKitGTK only pastes
 * natively (`capture`), or, in the desktop app, a file a file manager copied.
 *
 * Decided synchronously inside the paste event. Returns null and leaves the
 * event untouched when it brings no image; otherwise the promise resolves to
 * the image, or null when the source turns out to hold none, and rejects when
 * the image cannot be read. Pass `capture: false` from an editor whose own
 * paste handling already captures native pastes (ProseMirror's capturePaste).
 */
export function claimPastedImage(
  event: ClipboardEvent,
  { capture }: { capture: boolean }
): Promise<Blob | null> | null {
  const data = event.clipboardData;
  if (!data) return null;

  const file = imageFileOn(data);
  if (file) {
    event.preventDefault();
    return Promise.resolve(file);
  }
  // Only the desktop app can read a copied file; elsewhere the paste is left be.
  if (IS_DESKTOP && isCopiedFile(data)) {
    // Claimed now, or WebKit pastes a file:// link the page cannot load.
    event.preventDefault();
    return getClipboard().then((clipboard) => clipboard.readCopiedImageFile());
  }
  if (capture && Array.from(data.types ?? []).length === 0) return captureNativePaste();
  return null;
}
