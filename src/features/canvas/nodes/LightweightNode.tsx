import { useEffect, useMemo, useState } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { EditorContent, useEditor } from "@tiptap/react";
import DOMPurify from "dompurify";
import { useCanvasStore } from "../store";
import type { CanvasFlowNodeData } from "../reactFlowAdapter";
import { nodeEditorExtensions } from "./nodeEditorExtensions";
import { CanvasNodeHandles } from "./CanvasNodeHandles";
import { NodeFormatBubble } from "./NodeFormatBubble";

const CANVAS_LINK_URI =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|maibuk):|[^a-z]|[-a-z+.]+(?:[^-a-z+.:]|$))/i;

function sanitizeNodeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["class"],
    ALLOWED_URI_REGEXP: CANVAS_LINK_URI,
  });
}

type LightweightFlowNode = Node<CanvasFlowNodeData, "text">;

export function LightweightNode({
  data,
  selected,
}: NodeProps<LightweightFlowNode>) {
  const node = data.node;
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const [editing, setEditing] = useState(false);
  const safeHtml = useMemo(
    () => (node.kind === "text" ? sanitizeNodeHtml(node.html) : ""),
    [node],
  );

  const editor = useEditor(
    {
      extensions: nodeEditorExtensions,
      content: node.kind === "text" ? node.html : "",
      editable: editing,
      editorProps: { attributes: { class: "outline-none" } },
    },
    [editing],
  );

  useEffect(() => {
    if (editor && !editing && node.kind === "text") editor.commands.setContent(node.html);
  }, [editor, editing, node]);

  if (node.kind !== "text") return null;

  const commit = () => {
    if (editor) updateTextNode(node.id, { html: editor.getHTML() });
    setEditing(false);
  };

  return (
    <div
      className={`group relative min-w-24 max-w-72 px-2 py-1 text-sm text-foreground ${
        selected ? "ring-1 ring-primary/40" : ""
      }`}
      style={node.color ? { color: node.color } : undefined}
      onDoubleClick={() => !editorReadOnly && setEditing(true)}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="text" />
      {editing && editor ? (
        <>
          <EditorContent
            editor={editor}
            className="nodrag nopan prose prose-sm max-w-none"
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
          />
          <NodeFormatBubble editor={editor} />
        </>
      ) : (
        <div
          className="prose prose-sm max-w-none whitespace-pre-wrap"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: canvas node HTML is sanitized with DOMPurify above
          dangerouslySetInnerHTML={{ __html: safeHtml }}
        />
      )}
    </div>
  );
}
