import type { NodeTypes } from "@xyflow/react";
import { ImageNode } from "@/features/canvas/nodes/ImageNode";
import { LightweightNode } from "@/features/canvas/nodes/LightweightNode";
import { NoteRefNode } from "@/features/canvas/nodes/NoteRefNode";

export const nodeTypes = {
  text: LightweightNode,
  noteRef: NoteRefNode,
  image: ImageNode,
} satisfies NodeTypes;

export { ImageNode, LightweightNode, NoteRefNode };
