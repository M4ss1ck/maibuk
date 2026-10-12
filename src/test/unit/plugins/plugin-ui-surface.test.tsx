import { render, screen } from "@testing-library/react";
import type { RemoteMutationRecord } from "@remote-dom/core";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
import { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";

function insert(record: unknown): RemoteMutationRecord[] {
  return [record] as unknown as RemoteMutationRecord[];
}

describe("PluginRemoteUiSurface", () => {
  it("renders the tree the receiver holds", () => {
    const ui = createPluginRemoteUi({ onViolation: () => {} });
    ui.connection.mutate(
      insert([
        0,
        "~",
        {
          id: "1",
          type: 1,
          element: "maibuk-text",
          properties: {},
          children: [{ id: "2", type: 3, data: "Hello from the Plugin" }],
        },
        0,
      ])
    );

    render(<PluginRemoteUiSurface ui={ui} onError={() => {}} />);
    expect(screen.getByText("Hello from the Plugin")).toBeInTheDocument();
    ui.dispose();
  });

  it("catches a renderer error, reports it, and shows a fallback", () => {
    const onError = vi.fn();
    const ui = createPluginRemoteUi({ onViolation: () => {} });
    // Bypass the validator to prove the boundary: an element the map lacks
    // makes Remote DOM throw during render.
    ui.receiver.connection.mutate(
      insert([0, "~", { id: "1", type: 1, element: "maibuk-not-in-map", children: [] }, 0])
    );

    render(<PluginRemoteUiSurface ui={ui} onError={onError} />);
    expect(onError).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    ui.dispose();
  });
});
