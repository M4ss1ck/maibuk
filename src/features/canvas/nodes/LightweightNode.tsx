import { useEffect, useMemo, useRef, useState } from "react";
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
import { prepareStaticCanvasHtml } from "@/features/canvas/nodes/staticRichText";

type LightweightFlowNode = Node<CanvasFlowNodeData, "text">;

function ActiveNodeEditor({
  node,
  onDone,
  onCancel,
}: {
  node: LightweightCanvasNode;
  onDone: () => void;
  onCancel: () => void;
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
    editorProps: {
      attributes: { class: "outline-none" },
    },
  });

  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);

  if (!editor) return null;

  const commit = () => {
    updateTextNode(node.id, { html: editor.getHTML() });
    onDone();
  };

  return (
    <>
      <div
        className="canvas-node-content max-w-none"
        style={node.color ? { color: node.color } : undefined}
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
              onCancel();
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
  const [editing, setEditing] = useState(false);
  const html = node.kind === "text" ? node.html : null;
  const safeHtml = useMemo(() => (html === null ? "" : prepareStaticCanvasHtml(html)), [html]);

  if (node.kind !== "text") return null;

  const resizable = !editorReadOnly && !interactivityLocked && !editing;

  return (
    <div
      className={`group relative min-w-24 transform-gpu ${node.width ? "w-full" : "max-w-72"} px-2 py-1 text-sm text-foreground ${
        selected ? "ring-1 ring-primary/40" : ""
      }`}
      onDoubleClick={() => !editorReadOnly && setEditing(true)}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="text" />
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
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div
          className="canvas-node-content max-w-none"
          style={node.color ? { color: node.color } : undefined}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: canvas node HTML is sanitized with DOMPurify above
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      )}
    </div>
  );
}
