import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "@/components/editor/SelectionToolbar";
import {
  DEFAULT_TOOLBAR_CONFIG,
  setGroupFloatingVisible,
} from "@/features/settings/toolbar-config";
import { useSettingsStore } from "@/features/settings/store";
import { useModalStore } from "@/components/ui/modal-store";

vi.mock("@tiptap/react", () => ({
  useEditorState: ({
    editor,
    selector,
  }: {
    editor: unknown;
    selector: (value: { editor: unknown }) => unknown;
  }) => selector({ editor }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeEditor() {
  const listeners = new Map<string, () => void>();
  const scrollContainer = document.createElement("div");
  Object.defineProperty(scrollContainer, "getBoundingClientRect", {
    value: () => ({ top: 0, bottom: 500, left: 0, right: 800 }),
  });
  const dom = document.createElement("div");
  vi.spyOn(dom, "closest").mockReturnValue(scrollContainer);
  const chain = new Proxy({}, { get: () => () => chain });
  const can = new Proxy({}, { get: () => () => false });
  const editor = {
    state: {
      selection: { empty: false, from: 1, to: 3 },
    },
    view: {
      dom,
      coordsAtPos: (position: number) => ({
        top: 100,
        bottom: 120,
        left: position === 1 ? 200 : 260,
        right: position === 1 ? 200 : 260,
      }),
    },
    on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    off: vi.fn(),
    isActive: () => false,
    getAttributes: () => ({}),
    can: () => can,
    chain: () => chain,
    schema: { nodes: {} },
    commands: { toggleTaskList: vi.fn() },
  };
  return { editor, listeners };
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  useSettingsStore.setState({ toolbarConfig: DEFAULT_TOOLBAR_CONFIG });
  useModalStore.setState({ modalIds: [], openCount: 0 });
});

describe("SelectionToolbar", () => {
  it("mounts the styled bubble when floating groups are configured", () => {
    const { editor, listeners } = makeEditor();
    const { container } = render(
      <SelectionToolbar editor={editor as never} onLinkClick={vi.fn()} />
    );
    act(() => listeners.get("selectionUpdate")?.());
    expect(container.querySelector(".selection-toolbar-enter")).not.toBeNull();
  });

  it("does not mount the styled bubble when every floating group is disabled", () => {
    let config = DEFAULT_TOOLBAR_CONFIG;
    for (const id of ["basic-marks", "headings", "highlight", "link-code"] as const) {
      config = setGroupFloatingVisible(config, id, false);
    }
    useSettingsStore.setState({ toolbarConfig: config });
    const { editor, listeners } = makeEditor();
    const { container } = render(
      <SelectionToolbar editor={editor as never} onLinkClick={vi.fn()} />
    );
    act(() => listeners.get("selectionUpdate")?.());
    expect(container.querySelector(".selection-toolbar-enter")).toBeNull();
  });
});

describe("SelectionToolbar modal hiding", () => {
  it("hides the visible toolbar while any modal is open and reappears after the final close", () => {
    const { editor, listeners } = makeEditor();
    const { container } = render(
      <SelectionToolbar editor={editor as never} onLinkClick={vi.fn()} />
    );
    act(() => listeners.get("selectionUpdate")?.());

    expect(container.querySelector(".selection-toolbar-enter")).not.toBeNull();

    act(() => {
      useModalStore.getState().register("modal-1");
    });

    expect(container.querySelector(".selection-toolbar-enter")).toBeNull();

    act(() => {
      useModalStore.getState().unregister("modal-1");
    });

    act(() => listeners.get("selectionUpdate")?.());
    expect(container.querySelector(".selection-toolbar-enter")).not.toBeNull();
  });

  it("stays hidden while nested modals are still open", () => {
    const { editor, listeners } = makeEditor();
    const { container } = render(
      <SelectionToolbar editor={editor as never} onLinkClick={vi.fn()} />
    );
    act(() => listeners.get("selectionUpdate")?.());

    act(() => {
      useModalStore.getState().register("outer");
    });
    expect(container.querySelector(".selection-toolbar-enter")).toBeNull();

    act(() => {
      useModalStore.getState().register("inner");
    });
    expect(container.querySelector(".selection-toolbar-enter")).toBeNull();

    act(() => {
      useModalStore.getState().unregister("inner");
    });
    expect(container.querySelector(".selection-toolbar-enter")).toBeNull();

    act(() => {
      useModalStore.getState().unregister("outer");
    });
    act(() => listeners.get("selectionUpdate")?.());
    expect(container.querySelector(".selection-toolbar-enter")).not.toBeNull();
  });
});
