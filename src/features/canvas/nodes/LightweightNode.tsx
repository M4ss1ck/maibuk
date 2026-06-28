import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useCanvasStore } from "../store";
import type { CanvasFlowNodeData } from "../reactFlowAdapter";

type LightweightFlowNode = Node<CanvasFlowNodeData, "text">;

export function LightweightNode({ data, selected }: NodeProps<LightweightFlowNode>) {
  const node = data.node;
  const updateTextNode = useCanvasStore((state) => state.updateTextNode);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.kind === "text" ? node.text : "");
  const skipBlurSave = useRef(false);

  useEffect(() => {
    if (!editing && node.kind === "text") setDraft(node.text);
  }, [editing, node]);

  if (node.kind !== "text") return null;

  const save = () => {
    updateTextNode(node.id, { text: draft });
    setEditing(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      skipBlurSave.current = true;
      setDraft(node.text);
      setEditing(false);
    }
  };

  const accentColor =
    node.color && typeof CSS !== "undefined" && CSS.supports("color", node.color)
      ? node.color
      : undefined;

  return (
    <div
      className={`min-w-40 rounded-lg border bg-card px-4 py-3 text-foreground shadow-sm ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
      style={accentColor ? { borderTopColor: accentColor, borderTopWidth: 4 } : undefined}
      onDoubleClick={() => setEditing(true)}
    >
      <Handle type="target" position={Position.Left} />
      {editing ? (
        <input
          autoFocus
          className="nodrag nopan w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (skipBlurSave.current) {
              skipBlurSave.current = false;
              return;
            }
            save();
          }}
        />
      ) : (
        <p className="max-w-64 whitespace-pre-wrap text-sm">{node.text}</p>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
