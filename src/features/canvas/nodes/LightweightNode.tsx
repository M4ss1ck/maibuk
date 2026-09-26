import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { NodeResizeControl, ResizeControlVariant, type Node, type NodeProps } from "@xyflow/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCanvasStore } from "@/features/canvas/store";
import { useSettingsStore } from "@/features/settings/store";
import type { CanvasFlowNodeData } from "@/features/canvas/reactFlowAdapter";
import type { LightweightCanvasNode } from "@/features/canvas/types";
import { createRichTextExtensions } from "@/components/editor/extensions/createRichTextExtensions";
import { MarkdownPasteDialog } from "@/components/editor/MarkdownPasteDialog";
import { FootnoteList } from "@/components/editor/FootnoteList";
import { ImageContextMenu } from "@/components/editor/ImageContextMenu";
import { CanvasNodeHandles } from "@/features/canvas/nodes/CanvasNodeHandles";
import { NodeFormatBubble } from "@/features/canvas/nodes/NodeFormatBubble";
import { useCanvasNodeMenu } from "@/features/canvas/nodes/CanvasNodeMenu";
import { prepareStaticCanvasHtml } from "@/features/canvas/nodes/staticRichText";

type LightweightFlowNode = Node<CanvasFlowNodeData, "text">;

function ActiveNodeEditor({
  node,
  onDone,
  onExit,
}: {
  node: LightweightCanvasNode;
  onDone: () => void;
  /** Leave editing and hand focus back to the node (the Escape path). */
  onExit: () => void;
}) {
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const spellCheckEnabled = useSettingsStore((state) => state.spellCheckEnabled);
  const language = useSettingsStore((state) => state.language);
  const editorAutoClose = useSettingsStore((state) => state.editorAutoClose);
  const overlayOpen = useRef(false);
  const [pendingMarkdownPaste, setPendingMarkdownPaste] = useState<string | null>(null);
  const editor = useEditor({
    extensions: createRichTextExtensions({
      onMarkdownPaste: setPendingMarkdownPaste,
      footnoteStartIndex: 1,
      spellCheck: { enabled: spellCheckEnabled, language },
      autoClose: editorAutoClose,
    }),
    content: node.html,
    editable: true,
    // The node opens from a keyboard shortcut (F2) or a double click; TipTap's
    // autofocus is the reliable path that lands the caret in the new editor.
    autofocus: "end",
    editorProps: {
      attributes: { class: "outline-none" },
    },
  });

  // Focus during the commit that opens the editor, not in a passive effect:
  // a keyboard author's next keystroke (T then typing, F2 then Control+a)
  // arrives before a passive effect runs in WebKit, so the node wrapper would
  // still hold focus and the keys would hit the canvas instead of the text.
  // TipTap's focus command defers to requestAnimationFrame, which lands after
  // the keyboard author's next keystroke in WebKit (T then typing, F2 then
  // Control+a): the node wrapper would still be focused and the keys would hit
  // the canvas instead of the text. Focus the view synchronously during the
  // commit, then let the command's rAF settle the caret and scroll.
  useLayoutEffect(() => {
    editor?.view?.focus();
    editor?.commands.focus("end");
  }, [editor]);

  if (!editor) return null;

  const commit = (leave: () => void = onDone) => {
    updateTextNode(node.id, { html: editor.getHTML() });
    leave();
  };

  return (
    <>
      <div
        className="canvas-node-content max-w-none"
        style={node.textColor ? { color: node.textColor } : undefined}
      >
        <EditorContent
          editor={editor}
          className="nodrag nopan max-w-none"
          onBlur={() => {
            if (!overlayOpen.current && pendingMarkdownPaste === null) commit();
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              // Tab indents inside the editor and a pointer is the only way to
              // blur, so a keyboard-only author could never save their text.
              // Escape is the commit path: persist, then leave editing and
              // return focus to the node so the next Tab continues from there.
              commit(onExit);
            }
          }}
        />
        <FootnoteList editor={editor} startIndex={1} />
      </div>
      <NodeFormatBubble
        editor={editor}
        onOverlayOpenChange={(open) => {
          overlayOpen.current = open;
        }}
      />
      <ImageContextMenu editor={editor} />
      <MarkdownPasteDialog
        editor={editor}
        markdown={pendingMarkdownPaste}
        onClose={() => setPendingMarkdownPaste(null)}
      />
    </>
  );
}

export function LightweightNode({ data, selected }: NodeProps<LightweightFlowNode>) {
  const node = data.node;
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const beginLiveChange = useCanvasStore((state) => state.beginLiveChange);
  const resizeNodeLive = useCanvasStore((state) => state.resizeNodeLive);
  const endLiveChange = useCanvasStore((state) => state.endLiveChange);
  const editingNodeId = useCanvasStore((state) => state.editingNodeId);
  const beginNodeEdit = useCanvasStore((state) => state.beginNodeEdit);
  const endNodeEdit = useCanvasStore((state) => state.endNodeEdit);
  const editing = editingNodeId === node.id;
  const nodeMenu = useCanvasNodeMenu(node.id, {
    isDisabled: editorReadOnly || interactivityLocked || editing,
  });
  const html = node.kind === "text" ? node.html : null;
  const safeHtml = useMemo(() => (html === null ? "" : prepareStaticCanvasHtml(html)), [html]);

  if (node.kind !== "text") return null;

  const resizable = !editorReadOnly && !interactivityLocked && !editing;

  return (
    <div
      ref={nodeMenu.anchorRef}
      {...nodeMenu.itemProps}
      className={`group relative min-h-24 min-w-24 transform-gpu ${node.width ? "w-full" : "max-w-72"} rounded-lg px-3 py-2 text-sm text-foreground ${
        editing ? "" : "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]"
      } ${selected ? "ring-1 ring-primary/40" : ""}`}
      style={node.backgroundColor ? { backgroundColor: node.backgroundColor } : undefined}
      onDoubleClick={() => !editorReadOnly && beginNodeEdit(node.id)}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="text" selected={selected} />
      {nodeMenu.menu}
      {resizable &&
        (["left", "right"] as const).map((side) => (
          <NodeResizeControl
            key={side}
            position={side}
            variant={ResizeControlVariant.Line}
            resizeDirection="horizontal"
            minWidth={160}
            className={`nodrag z-0! w-1! rounded-full! border-0! bg-primary! transition-opacity ${
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
            onResizeStart={beginLiveChange}
            onResize={(_event, params) =>
              resizeNodeLive(node.id, {
                position: { x: params.x, y: params.y },
                width: params.width,
              })
            }
            onResizeEnd={endLiveChange}
          />
        ))}
      {editing ? (
        <ActiveNodeEditor
          node={node}
          onDone={endNodeEdit}
          onExit={() => {
            // Unmount the editor first, then focus the node it lived in, so
            // Escape leaves the keyboard author on the node rather than on the
            // document body.
            flushSync(endNodeEdit);
            nodeMenu.anchorRef.current?.focus();
          }}
        />
      ) : (
        <div
          className="canvas-node-content max-w-none"
          style={node.textColor ? { color: node.textColor } : undefined}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: canvas node HTML is sanitized with DOMPurify above
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      )}
    </div>
  );
}
