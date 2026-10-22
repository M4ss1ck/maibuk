import { describe, expect, it, vi } from "vitest";
import { onRollupWarn } from "../../../../scripts/rollup-warnings";

const ZOD_ID = "/repo/node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/util.js";

describe("onRollupWarn", () => {
  it("drops an INVALID_ANNOTATION raised from a dependency", () => {
    const warn = vi.fn();
    onRollupWarn({ code: "INVALID_ANNOTATION", id: ZOD_ID }, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops it for a Windows path too", () => {
    const warn = vi.fn();
    onRollupWarn({ code: "INVALID_ANNOTATION", id: "C:\\repo\\node_modules\\zod\\util.js" }, warn);
    expect(warn).not.toHaveBeenCalled();
  });

  it("forwards an INVALID_ANNOTATION raised from our own source", () => {
    const warn = vi.fn();
    const warning = { code: "INVALID_ANNOTATION", id: "/repo/src/lib/pure.ts" };
    onRollupWarn(warning, warn);
    expect(warn).toHaveBeenCalledWith(warning);
  });

  it("forwards an INVALID_ANNOTATION with no module id", () => {
    const warn = vi.fn();
    const warning = { code: "INVALID_ANNOTATION" };
    onRollupWarn(warning, warn);
    expect(warn).toHaveBeenCalledWith(warning);
  });

  it("forwards every other warning from a dependency", () => {
    const warn = vi.fn();
    const warning = { code: "CIRCULAR_DEPENDENCY", id: ZOD_ID };
    onRollupWarn(warning, warn);
    expect(warn).toHaveBeenCalledWith(warning);
  });
});
