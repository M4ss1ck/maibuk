import { describe, expect, it, vi } from "vitest";
import { registerBackDismiss, runTopBackDismiss } from "@/lib/platform/backDismiss";

describe("backDismiss registry", () => {
  it("invokes dismissers newest-first and stops at the first handler", () => {
    const older = vi.fn(() => true);
    const newer = vi.fn(() => true);
    const unregOlder = registerBackDismiss(older);
    const unregNewer = registerBackDismiss(newer);

    expect(runTopBackDismiss()).toBe(true);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(older).not.toHaveBeenCalled();

    unregNewer();
    unregOlder();
  });

  it("falls through dismissers that decline until one handles", () => {
    const declines = vi.fn(() => false);
    const handles = vi.fn(() => true);
    const unregA = registerBackDismiss(handles);
    const unregB = registerBackDismiss(declines);

    expect(runTopBackDismiss()).toBe(true);
    expect(declines).toHaveBeenCalledTimes(1);
    expect(handles).toHaveBeenCalledTimes(1);

    unregA();
    unregB();
  });

  it("returns false when nothing is registered", () => {
    expect(runTopBackDismiss()).toBe(false);
  });

  it("unregister removes the dismisser", () => {
    const fn = vi.fn(() => true);
    const unreg = registerBackDismiss(fn);
    unreg();
    expect(runTopBackDismiss()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });
});
