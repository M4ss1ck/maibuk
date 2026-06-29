import type { NodeTypes } from "@xyflow/react";
import { LightweightNode } from "@/features/canvas/nodes/LightweightNode";
import { NoteRefNode } from "@/features/canvas/nodes/NoteRefNode";

export const nodeTypes = {
  text: LightweightNode,
  noteRef: NoteRefNode,
} satisfies NodeTypes;

export { LightweightNode, NoteRefNode };
