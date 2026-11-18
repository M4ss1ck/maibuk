/**
 * The desktop build of usePluginFileDrop (#828): Tauri reports an OS drop
 * through the webview, never the DOM, so the hook hit-tests the drop point
 * against the page and asks the store to grant the dropped paths.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ IS_TAURI: true }));

type DragDropHandler = (event: {
  payload: { type: string; paths: string[]; position: { x: number; y: number } };
}) => void;
const webview = vi.hoisted(() => ({ handler: null as DragDropHandler | null }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: DragDropHandler) => {
      webview.handler = handler;
      return () => {
        webview.handler = null;
      };
    },
  }),
}));

import { usePluginFileDrop } from "@/components/plugins/usePluginFileDrop";
import { registerPluginFileGrantStore } from "@/features/plugins/file-grants";
import type { PluginLifecycle } from "@/features/plugins/types";
import type { PluginFileGrantStore } from "@/lib/platform/types";

const PLUGIN = "maibuk-reader";
const PAGE = "reader";

function mount(accepts: boolean) {
  const broker = { accepts: vi.fn(() => accepts), emit: vi.fn(() => true) };
  const lifecycle = {
    runtime: (pluginId: string) => (pluginId === PLUGIN ? { broker } : null),
  } as unknown as PluginLifecycle;
  const drop = vi.fn(async (_pluginId: string, files: readonly { path?: string }[]) =>
    files.map((file, index) => ({ grant: `grant-${index}`, name: file.path ?? "", size: 1 }))
  );
  registerPluginFileGrantStore({ drop } as unknown as PluginFileGrantStore);
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({ left: 100, top: 100, right: 300, bottom: 300 }) as DOMRect;
  document.body.append(element);
  const hook = renderHook(() => usePluginFileDrop(lifecycle, PLUGIN, PAGE, element));
  return { ...hook, broker, drop };
}

function osDrop(x: number, y: number, paths: string[]) {
  webview.handler?.({ payload: { type: "drop", paths, position: { x, y } } });
}

afterEach(() => {
  registerPluginFileGrantStore(null);
  document.body.replaceChildren();
});

describe("usePluginFileDrop() on desktop", () => {
  it("grants the dropped paths and emits files.dropped for a drop on the page", async () => {
    const { broker, drop } = mount(true);
    await waitFor(() => expect(webview.handler).not.toBeNull());

    osDrop(150, 150, ["/home/a/Dune.epub", "/home/a/notes.docx"]);

    await waitFor(() =>
      expect(broker.emit).toHaveBeenCalledWith("files.dropped", {
        page: PAGE,
        grants: [
          { grant: "grant-0", name: "/home/a/Dune.epub", size: 1 },
          { grant: "grant-1", name: "/home/a/notes.docx", size: 1 },
        ],
      })
    );
    expect(drop).toHaveBeenCalledWith(PLUGIN, [
      { path: "/home/a/Dune.epub" },
      { path: "/home/a/notes.docx" },
    ]);
  });

  it("grants nothing for a drop outside the page", async () => {
    const { broker, drop } = mount(true);
    await waitFor(() => expect(webview.handler).not.toBeNull());

    osDrop(20, 20, ["/home/a/Dune.epub"]);

    await Promise.resolve();
    expect(drop).not.toHaveBeenCalled();
    expect(broker.emit).not.toHaveBeenCalled();
  });

  it("grants nothing when the Plugin does not take drops", async () => {
    const { broker, drop } = mount(false);
    await waitFor(() => expect(webview.handler).not.toBeNull());

    osDrop(150, 150, ["/home/a/Dune.epub"]);

    await Promise.resolve();
    expect(drop).not.toHaveBeenCalled();
    expect(broker.emit).not.toHaveBeenCalled();
  });

  it("stops listening once the page unmounts", async () => {
    const { unmount } = mount(true);
    await waitFor(() => expect(webview.handler).not.toBeNull());

    unmount();

    await waitFor(() => expect(webview.handler).toBeNull());
  });
});
