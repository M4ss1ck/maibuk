import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";

/**
 * Detect whether the OS clipboard has pasteable content. Must be called inside
 * a user-activation window (e.g. a pointerdown handler) — WebKitGTK rejects
 * clipboard reads in the contextmenu event itself.
 */
async function probeClipboard(): Promise<boolean> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (
        item.types.includes("text/html") ||
        item.types.includes("text/plain")
      ) {
        return true;
      }
    }
  } catch {
    // fall through to readText
  }
  try {
    const text = await navigator.clipboard.readText();
    return text.length > 0;
  } catch {
    return false;
  }
}

/**
 * Programmatic-paste fallback for platforms where document.execCommand("paste")
 * is blocked. Bypasses PasteHandler/transformPastedHTML — only used when the
 * synchronous paste event can't be triggered.
 */
export async function fallbackPaste(editor: Editor): Promise<void> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const blob = await item.getType("text/html");
        const html = await blob.text();
        editor.chain().focus().insertContent(html).run();
        return;
      }
    }
    const text = await navigator.clipboard.readText();
    editor.chain().focus().insertContent(text).run();
  } catch {
    try {
      const text = await navigator.clipboard.readText();
      editor.chain().focus().insertContent(text).run();
    } catch {
      // give up silently
    }
  }
}

/**
 * Pre-warms a clipboard probe on right-click / long-press, so the contextmenu
 * handler can read its result without needing fresh transient activation.
 *
 * Returns a `consumeProbe` function: call it once per menu open to get the
 * latest probe promise (or a resolved-false promise if none is pending).
 */
export function useClipboardProbe(editor: Editor): () => Promise<boolean> {
  const probeRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onPointerDown = (event: PointerEvent) => {
      const isRightClick =
        event.pointerType === "mouse" && event.button === 2;
      const isTouchOrPen =
        event.pointerType === "touch" || event.pointerType === "pen";
      if (!isRightClick && !isTouchOrPen) return;
      probeRef.current = probeClipboard();
    };
    dom.addEventListener("pointerdown", onPointerDown);
    return () => dom.removeEventListener("pointerdown", onPointerDown);
  }, [editor]);

  return useCallback(() => {
    const promise = probeRef.current ?? Promise.resolve(false);
    probeRef.current = null;
    return promise;
  }, []);
}
