import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToolbarPressed,
  isToolbarPressed,
  setToolbarPressed,
  subscribeToolbarPressed,
  toolbarPressedRevision,
} from "@/features/plugins/toolbar-pressed";

afterEach(() => {
  clearToolbarPressed("alpha");
  clearToolbarPressed("beta");
});

describe("Toggle Button pressed state", () => {
  it("is off until the Plugin sets it on", () => {
    expect(isToolbarPressed("alpha", "toggle")).toBe(false);
    setToolbarPressed("alpha", "toggle", true);
    expect(isToolbarPressed("alpha", "toggle")).toBe(true);
  });

  it("keys each button by its Plugin and local id", () => {
    setToolbarPressed("alpha", "toggle", true);
    expect(isToolbarPressed("beta", "toggle")).toBe(false);
    expect(isToolbarPressed("alpha", "other")).toBe(false);
  });

  it("clears every button of one Plugin and leaves the others", () => {
    setToolbarPressed("alpha", "one", true);
    setToolbarPressed("alpha", "two", true);
    setToolbarPressed("beta", "one", true);

    clearToolbarPressed("alpha");

    expect(isToolbarPressed("alpha", "one")).toBe(false);
    expect(isToolbarPressed("alpha", "two")).toBe(false);
    expect(isToolbarPressed("beta", "one")).toBe(true);
  });

  it("notifies subscribers and advances the revision on every actual change only", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToolbarPressed(listener);
    const before = toolbarPressedRevision();

    setToolbarPressed("alpha", "toggle", true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(toolbarPressedRevision()).toBeGreaterThan(before);

    const afterOn = toolbarPressedRevision();
    setToolbarPressed("alpha", "toggle", true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(toolbarPressedRevision()).toBe(afterOn);

    clearToolbarPressed("beta");
    expect(listener).toHaveBeenCalledTimes(1);

    clearToolbarPressed("alpha");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setToolbarPressed("alpha", "toggle", true);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
