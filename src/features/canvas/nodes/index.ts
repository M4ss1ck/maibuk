import type { NodeTypes } from "@xyflow/react";
import { ImageNode } from "@/features/canvas/nodes/ImageNode";
import { LightweightNode } from "@/features/canvas/nodes/LightweightNode";
import { ReferenceNode } from "@/features/canvas/nodes/ReferenceNode";

export const nodeTypes = {
  text: LightweightNode,
  reference: ReferenceNode,
  image: ImageNode,
} satisfies NodeTypes;

export { ImageNode, LightweightNode, ReferenceNode };
