import type { NodeTypes } from "@xyflow/react";
import { LightweightNode } from "./LightweightNode";
import { NoteRefNode } from "./NoteRefNode";

export const nodeTypes = {
  text: LightweightNode,
  noteRef: NoteRefNode,
} satisfies NodeTypes;

export { LightweightNode, NoteRefNode };
