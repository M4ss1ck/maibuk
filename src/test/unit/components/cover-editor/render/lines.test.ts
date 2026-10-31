import { describe, expect, it } from "vitest";
import { buildGuideLine } from "@/components/cover-editor/render/overlays";
import { buildObject } from "@/components/cover-editor/render/toFabric";
import { createShapeLayer } from "@/features/covers/scene/defaults";
import type { CoverDoc } from "@/features/covers/scene/schema";

// Fabric 7 deprecates Line for Polyline (issue #670). These freeze the
// footprint the deprecated Line drew, so the migration cannot move a line.
describe("cover lines", () => {
  it("draws a line Layer at its position, width, and stroke", async () => {
    const layer = {
      ...createShapeLayer({ shape: "line", docWidth: 1000, docHeight: 1600 }),
      x: 120,
      y: 340,
    };
    const obj = await buildObject(layer);
    expect(obj).not.toBeNull();
    expect({
      left: obj!.left,
      top: obj!.top,
      width: obj!.width,
      height: obj!.height,
      stroke: obj!.stroke,
      strokeWidth: obj!.strokeWidth,
      bounds: obj!.getBoundingRect(),
    }).toEqual({
      left: 120,
      top: 340,
      width: 400,
      height: 0,
      stroke: "#e94560",
      strokeWidth: 4,
      bounds: { left: 120, top: 340, width: 404, height: 4 },
    });
  });

  it("draws snap guides across the whole document", () => {
    const doc = { width: 1000, height: 1600 } as CoverDoc;
    const vertical = buildGuideLine("v", 250, doc).getBoundingRect();
    const horizontal = buildGuideLine("h", 800, doc).getBoundingRect();
    expect(vertical).toEqual({ left: 249.5, top: -0.5, width: 1, height: 1601 });
    expect(horizontal).toEqual({ left: -0.5, top: 799.5, width: 1001, height: 1 });
  });
});
