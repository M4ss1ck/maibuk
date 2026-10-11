import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastViewport } from "@/components/ui/Toast";
import { createPluginHandlers } from "@/features/plugins/handlers";
import { PLUGIN_MANIFEST } from "@/test/support/plugin-fixtures";

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
