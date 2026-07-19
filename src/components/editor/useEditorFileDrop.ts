import { useEffect } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { buildDropHtml } from "@/components/editor/file-drop-html";
import { readDroppedTauriPaths } from "@/hooks/useTextFileDrop";
import { IS_TAURI } from "@/lib/platform";

/**
 * Tauri-only file drop for the editor. The webview swallows DOM drag events,
 * so Dropcursor never runs; instead we track Tauri's onDragDropEvent, draw a
 * caret decoration at the hovered document position, and insert the dropped
 * files' converted content there.
 */

export const fileDropCaretKey = new PluginKey<number | null>("fileDropCaret");

/** Widget decoration at the hovered position; state is the position or null. */
export function createFileDropCaretPlugin(): Plugin<number | null> {
  return new Plugin<number | null>({
    key: fileDropCaretKey,
    state: {
      init: () => null,
      apply: (tr, value) => {
        const meta = tr.getMeta(fileDropCaretKey);
        if (meta !== undefined) return meta as number | null;
        return value === null ? null : tr.mapping.map(value);
      },
    },
    props: {
      decorations(state) {
        const pos = fileDropCaretKey.getState(state);
        if (pos === null || pos === undefined) return DecorationSet.empty;
        const caret = document.createElement("span");
        caret.className = "file-drop-caret";
        return DecorationSet.create(state.doc, [Decoration.widget(pos, caret)]);
      },
    },
  });
}

export function useEditorFileDrop(
  editor: TiptapEditor | null,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!IS_TAURI || !editor || !enabled) return;

    const plugin = createFileDropCaretPlugin();
    editor.registerPlugin(plugin);

    const setCaret = (pos: number | null) => {
      const { state, dispatch } = editor.view;
      dispatch(state.tr.setMeta(fileDropCaretKey, pos));
    };

    const posAt = (x: number, y: number): number | null => {
      const view = editor.view;
      const rect = view.dom.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
        return null;
      return view.posAtCoords({ left: x, top: y })?.pos ?? null;
    };

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      let dispose: (() => void) | undefined;
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        dispose = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          const dpr = window.devicePixelRatio || 1;

          if (payload.type === "enter" || payload.type === "over") {
            setCaret(posAt(payload.position.x / dpr, payload.position.y / dpr));
            return;
          }

          if (payload.type === "drop") {
            const pos = posAt(
              payload.position.x / dpr,
              payload.position.y / dpr,
            );
            setCaret(null);
            if (pos === null) return;
            void (async () => {
              const files = await readDroppedTauriPaths(payload.paths);
              const html = buildDropHtml(files);
              if (!html) return;
              editor.chain().focus().insertContentAt(pos, html).run();
            })();
            return;
          }

          setCaret(null);
        });
      } catch {
        return;
      }
      if (cancelled) dispose();
      else unlisten = dispose;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      if (!editor.isDestroyed) editor.unregisterPlugin(fileDropCaretKey);
    };
  }, [editor, enabled]);
}
