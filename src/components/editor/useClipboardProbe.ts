import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { looksLikeMarkdown } from "../../features/markdown";
import { useSettingsStore } from "../../features/settings/store";
import {
  hasRichFormatting,
  plainTextToHtml,
  readClipboardImageDataUrl,
  readClipboardSnapshot,
  snapshotToPlainText,
} from "./clipboard";
import { cleanPastedHtml } from "./paste-cleanup";

export interface ClipboardProbe {
  canPaste: boolean;
  hasFormatting: boolean;
}

/**
 * Detect whether the OS clipboard has pasteable content and whether it carries
 * formatting. Must run inside a user-activation window (e.g. a pointerdown
 * handler) — WebKitGTK rejects clipboard reads in the contextmenu event itself.
 */
async function probeClipboard(): Promise<ClipboardProbe> {
  const snap = await readClipboardSnapshot();
  const canPaste = Boolean(snap.text) || Boolean(snap.html) || snap.hasImage;
  const hasFormatting =
    (snap.html !== null && hasRichFormatting(snap.html)) || looksLikeMarkdown(snap.text);
  return { canPaste, hasFormatting };
}

/**
 * Programmatic-paste fallback for platforms where document.execCommand("paste")
 * is blocked. Bypasses PasteHandler/transformPastedHTML — only used when the
 * synchronous paste event can't be triggered.
 */
export async function fallbackPaste(editor: Editor): Promise<void> {
  const snap = await readClipboardSnapshot();
  if (snap.hasImage && !snap.text && !snap.html) {
    const dataUrl = await readClipboardImageDataUrl();
    if (dataUrl) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "image", attrs: { src: dataUrl } })
        .run();
      return;
    }
  }

  if (snap.html) {
    const settings = useSettingsStore.getState().pasteCleanup;
    editor.chain().focus().insertContent(cleanPastedHtml(snap.html, settings)).run();
    return;
  }

  if (snap.text) {
    editor.chain().focus().insertContent(snap.text).run();
  }
}

/**
 * Insert clipboard content as literal plain text — strips HTML formatting and
 * never converts markdown. Equivalent to Ctrl/Cmd+Shift+V.
 */
export async function pasteWithoutFormatting(editor: Editor): Promise<void> {
  const snap = await readClipboardSnapshot();
  const text = snapshotToPlainText(snap);
  if (!text) return;
  editor.chain().focus().insertContent(plainTextToHtml(text)).run();
}

/**
 * Pre-warms a clipboard probe on right-click / long-press, so the contextmenu
 * handler can read its result without needing fresh transient activation.
 *
 * Returns a `consumeProbe` function: call it once per menu open to get the
 * latest probe promise (or a resolved-empty probe if none is pending).
 */
export function useClipboardProbe(editor: Editor): () => Promise<ClipboardProbe> {
  const probeRef = useRef<Promise<ClipboardProbe> | null>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onPointerDown = (event: PointerEvent) => {
      const isRightClick = event.pointerType === "mouse" && event.button === 2;
      const isTouchOrPen = event.pointerType === "touch" || event.pointerType === "pen";
      if (!isRightClick && !isTouchOrPen) return;
      probeRef.current = probeClipboard();
    };
    dom.addEventListener("pointerdown", onPointerDown);
    return () => dom.removeEventListener("pointerdown", onPointerDown);
  }, [editor]);

  return useCallback(() => {
    const promise = probeRef.current ?? Promise.resolve({ canPaste: false, hasFormatting: false });
    probeRef.current = null;
    return promise;
  }, []);
}
