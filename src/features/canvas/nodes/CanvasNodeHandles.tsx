import { Handle, Position } from "@xyflow/react";
import { useCanvasStore } from "../store";
import type { Side, SideConnection } from "../reactFlowAdapter";

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

// Push the connection ports a few px outside the node edge so they no longer
// overlap the resize grips that sit on the edges themselves.
const SIDE_OFFSET: Record<Side, string> = {
  top: "!-mt-2",
  right: "!-mr-2",
  bottom: "!-mb-2",
  left: "!-ml-2",
};

const STUB_CLASS: Record<Side, string> = {
  top: "left-1/2 top-0 h-1 w-8 -translate-x-1/2 border-t-2",
  right: "right-0 top-1/2 h-8 w-1 -translate-y-1/2 border-r-2",
  bottom: "bottom-0 left-1/2 h-1 w-8 -translate-x-1/2 border-b-2",
  left: "left-0 top-1/2 h-8 w-1 -translate-y-1/2 border-l-2",
};

function stubColor(side: SideConnection): string {
  if (side.incoming) return "border-primary";
  if (side.outgoing) return "border-muted-foreground";
  return "border-border";
}

export function CanvasNodeHandles({
  connectedSides,
  variant,
}: {
  connectedSides: Record<Side, SideConnection>;
  variant: "text" | "card";
}) {
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const interactive = !editorReadOnly && !interactivityLocked;
  const sides: Side[] = ["top", "right", "bottom", "left"];
  return (
    <>
      {interactive && (
        <>
          {/*
           * Invisible hover halo: extends the node's hover region past its edge
           * so reaching for the outside connection ports never drops the
           * group-hover state and flickers the affordances. Sits behind content
           * (-z-10) and keeps no nodrag so the node body stays draggable.
           */}
          <div aria-hidden="true" className="pointer-events-auto absolute -inset-3.5 -z-10" />
          {sides.map((side) => (
            <Handle
              key={side}
              id={side}
              type="source"
              position={SIDE_POSITION[side]}
              className={`!z-10 !h-2.5 !w-2.5 !rounded-full !border-2 !border-primary !bg-background opacity-0 transition-opacity group-hover:opacity-100 ${SIDE_OFFSET[side]}`}
            />
          ))}
        </>
      )}
      {variant === "text" &&
        sides
          .filter((side) => connectedSides[side].connected)
          .map((side) => (
            <span
              key={`stub-${side}`}
              aria-hidden="true"
              className={`pointer-events-none absolute ${STUB_CLASS[side]} ${stubColor(connectedSides[side])}`}
            />
          ))}
    </>
  );
}
