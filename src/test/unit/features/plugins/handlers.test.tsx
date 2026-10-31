import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastViewport } from "@/components/ui/Toast";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { clearToolbarPressed, isToolbarPressed } from "@/features/plugins/toolbar-pressed";
import type { PluginManifest } from "@/features/plugins/types";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";
import { PluginApiError } from "@/plugin-sdk/protocol";

const TOGGLE_MANIFEST: PluginManifest = {
  ...PLUGIN_MANIFEST,
  contributes: {
    toolbarButtons: [
      { id: "toggle", command: "run", icon: "book-open", toggle: true },
      { id: "plain", command: "run", icon: "book-open" },
    ],
  },
};

afterEach(() => {
  clearToolbarPressed(TOGGLE_MANIFEST.id);
});

describe("createPluginHandlers()", () => {
  it("shows a toast naming the Plugin for notifications.show", async () => {
    const handlers = createPluginHandlers(PLUGIN_MANIFEST);
    const show = handlers["notifications.show"];
    if (!show) throw new Error("notifications.show is not wired");
    const result = await show({ variant: "info", message: "hello" }, { pluginId: "tracer" });
    expect(result).toBeNull();
    render(<ToastViewport />);
    expect(screen.getByRole("status")).toHaveTextContent("Tracer: hello");
  });
});

describe("toolbar.setPressed", () => {
  // Async, so a refusal arrives as a rejection the way the broker delivers it.
  const setPressed = async (button: string, pressed: boolean) => {
    const handler = createPluginHandlers(TOGGLE_MANIFEST)["toolbar.setPressed"];
    if (!handler) throw new Error("toolbar.setPressed is not wired");
    return handler({ button, pressed }, { pluginId: TOGGLE_MANIFEST.id });
  };

  it("sets a declared Toggle Button pressed and back off, returning null", async () => {
    await expect(setPressed("toggle", true)).resolves.toBeNull();
    expect(isToolbarPressed(TOGGLE_MANIFEST.id, "toggle")).toBe(true);

    await expect(setPressed("toggle", false)).resolves.toBeNull();
    expect(isToolbarPressed(TOGGLE_MANIFEST.id, "toggle")).toBe(false);
  });

  it("refuses an id the manifest does not declare with invalid-params and changes nothing", async () => {
    const attempt = setPressed("missing", true);
    await expect(attempt).rejects.toBeInstanceOf(PluginApiError);
    await expect(attempt).rejects.toMatchObject({
      code: "invalid-params",
      message: "No toolbar button missing",
    });
    expect(isToolbarPressed(TOGGLE_MANIFEST.id, "missing")).toBe(false);
  });

  it("refuses a button that is not a Toggle Button with invalid-params and changes nothing", async () => {
    const attempt = setPressed("plain", true);
    await expect(attempt).rejects.toBeInstanceOf(PluginApiError);
    await expect(attempt).rejects.toMatchObject({
      code: "invalid-params",
      message: "Toolbar button plain is not a Toggle Button",
    });
    expect(isToolbarPressed(TOGGLE_MANIFEST.id, "plain")).toBe(false);
  });
});
