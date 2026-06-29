import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import type { SceneBreakAttrs } from "@/components/editor/extensions/scene-break-utils";

export function SceneBreakView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as SceneBreakAttrs;

  return (
    <NodeViewWrapper
      data-scene-break=""
      className={`scene-break flex justify-center my-6 select-none ${
        selected ? "ring-2 ring-primary rounded" : ""
      }`}
    >
      {attrs.kind === "image" && attrs.src ? (
        <img src={attrs.src} alt={attrs.alt ?? ""} className="max-h-16 object-contain" />
      ) : (
        <span className="scene-break-symbols tracking-[0.3em]">{attrs.symbols}</span>
      )}
    </NodeViewWrapper>
  );
}
