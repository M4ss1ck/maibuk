import { useEffect, useMemo, useRef, useState } from "react";
import {
  NodeResizeControl,
  ResizeControlVariant,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { EditorContent, useEditor } from "@tiptap/react";
import DOMPurify from "dompurify";
import { useCanvasStore } from "../store";
import type { CanvasFlowNodeData } from "../reactFlowAdapter";
import type { LightweightCanvasNode } from "../types";
import { nodeEditorExtensions } from "./nodeEditorExtensions";
import { CanvasNodeHandles } from "./CanvasNodeHandles";
import { NodeFormatBubble } from "./NodeFormatBubble";

const CANVAS_LINK_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|maibuk):|[^a-z]|[-a-z+.]+(?:[^-a-z+.:]|$))/i;

function sanitizeNodeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["class"],
    ALLOWED_URI_REGEXP: CANVAS_LINK_URI,
  }).replace(/<p><\/p>/g, "<p><br></p>");
}

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
  const linkDialogOpen = useRef(false);
  const editor = useEditor({
    extensions: nodeEditorExtensions,
    content: node.html,
    editable: true,
    editorProps: {
      attributes: { class: "canvas-node-content outline-none" },
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
      <EditorContent
        editor={editor}
        className="nodrag nopan max-w-none"
        onBlur={() => {
          if (!linkDialogOpen.current) commit();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <NodeFormatBubble
        editor={editor}
        onLinkDialogOpenChange={(open) => {
          linkDialogOpen.current = open;
        }}
      />
    </>
  );
}

export function LightweightNode({
  data,
  selected,
}: NodeProps<LightweightFlowNode>) {
  const node = data.node;
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const resizeTextNode = useCanvasStore((state) => state.resizeTextNode);
  const [editing, setEditing] = useState(false);
  const safeHtml = useMemo(
    () => (node.kind === "text" ? sanitizeNodeHtml(node.html) : ""),
    [node],
  );

  if (node.kind !== "text") return null;

  const resizable = selected && !editorReadOnly && !editing;

  return (
    <div
      className={`group relative min-w-24 ${node.width ? "w-full" : "max-w-72"} px-2 py-1 text-sm text-foreground ${
        selected ? "ring-1 ring-primary/40" : ""
      }`}
      style={node.color ? { color: node.color } : undefined}
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
            className="nodrag !z-0 !border-primary/50"
            onResizeEnd={(_event, params) =>
              resizeTextNode(node.id, {
                position: { x: params.x, y: params.y },
                width: params.width,
              })
            }
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
          // biome-ignore lint/security/noDangerouslySetInnerHtml: canvas node HTML is sanitized with DOMPurify above
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      )}
    </div>
  );
}
