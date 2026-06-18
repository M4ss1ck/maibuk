import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../../i18n", () => ({
  default: { language: "en", changeLanguage: vi.fn() },
  detectSystemLocale: vi.fn().mockResolvedValue("en"),
}));

vi.mock("../../../../lib/platform", () => ({
  setLaunchOnStartup: vi.fn().mockResolvedValue(undefined),
}));

const { useEditorZoomControls, wheelZoomDirection } = await import(
  "../../../../components/editor/useEditorZoomControls"
);
const { useSettingsStore } = await import(
  "../../../../features/settings/store"
);

describe("wheelZoomDirection", () => {
  it("returns null without ctrl/meta", () => {
    expect(
      wheelZoomDirection({ ctrlKey: false, metaKey: false, deltaY: -5 } as WheelEvent)
    ).toBeNull();
  });

  it("maps ctrl + negative deltaY to zoom in, positive to out", () => {
    expect(
      wheelZoomDirection({ ctrlKey: true, metaKey: false, deltaY: -5 } as WheelEvent)
    ).toBe("in");
    expect(
      wheelZoomDirection({ ctrlKey: true, metaKey: false, deltaY: 5 } as WheelEvent)
    ).toBe("out");
  });
});

describe("useEditorZoomControls", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ editorZoom: 100 });
  });

  it("Ctrl+= zooms in, Ctrl+- zooms out, Ctrl+0 resets", () => {
    renderHook(() => useEditorZoomControls(null));

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "=", ctrlKey: true })
    );
    expect(useSettingsStore.getState().editorZoom).toBe(110);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "-", ctrlKey: true })
    );
    expect(useSettingsStore.getState().editorZoom).toBe(100);

    useSettingsStore.setState({ editorZoom: 200 });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "0", ctrlKey: true })
    );
    expect(useSettingsStore.getState().editorZoom).toBe(100);
  });

  it("Ctrl+wheel over the element zooms and prevents default", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    renderHook(() => useEditorZoomControls(el));

    const event = new WheelEvent("wheel", {
      deltaY: -10,
      ctrlKey: true,
      cancelable: true,
    });
    el.dispatchEvent(event);
    expect(useSettingsStore.getState().editorZoom).toBe(110);
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(el);
  });
});
