import { Handle, Position } from "@xyflow/react";
import type { Side, SideConnection } from "../reactFlowAdapter";

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
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
  const sides: Side[] = ["top", "right", "bottom", "left"];
  return (
    <>
      {sides.map((side) => (
        <Handle
          key={side}
          id={side}
          type="source"
          position={SIDE_POSITION[side]}
          className="!h-2 !w-2 !border !border-border !bg-background opacity-0 transition-opacity group-hover:opacity-100"
        />
      ))}
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
