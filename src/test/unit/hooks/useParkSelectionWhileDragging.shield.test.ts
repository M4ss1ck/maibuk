import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockPark } = vi.hoisted(() => ({ mockPark: vi.fn() }));
vi.mock("@/lib/park-selection", () => ({ parkInertSelection: mockPark }));

import { useParkSelectionWhileDragging } from "@/hooks/useParkSelectionWhileDragging";

function buildPage() {
  const list = document.createElement("ul");
  const shield = document.createElement("main");
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  editor.setAttribute("contenteditable", "true");
  shield.append(editor);
  document.body.append(list, shield);
  return { list, shield };
}

beforeEach(() => {
  document.body.replaceChildren();
  mockPark.mockReset().mockReturnValue(() => {});
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
});

describe("useParkSelectionWhileDragging() editor shield", () => {
  it("inerts the editor's outside synchronously when a keyboard drag starts, before React Aria's session frame", () => {
    const { list, shield } = buildPage();
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    expect(shield.hasAttribute("inert")).toBe(true);
  });

  it("releases the shield when the drag ends", () => {
    const { list, shield } = buildPage();
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    result.current.onDragEnd(undefined);
    expect(shield.hasAttribute("inert")).toBe(false);
  });

  it("releases the shield when the list unmounts mid-drag", () => {
    const { list, shield } = buildPage();
    const { result, unmount } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    unmount();
    expect(shield.hasAttribute("inert")).toBe(false);
  });

  it("leaves a native pointer drag alone (React Aria starts no session for it)", () => {
    const { list, shield } = buildPage();
    document.dispatchEvent(new Event("pointerdown"));
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    expect(shield.hasAttribute("inert")).toBe(false);
  });

  it("never removes an inert another author set on the shield", () => {
    const { list, shield } = buildPage();
    shield.setAttribute("inert", "");
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    result.current.onDragEnd(undefined);
    expect(shield.hasAttribute("inert")).toBe(true);
  });

  it("without shieldEditorFrom, touches no DOM", () => {
    const { shield } = buildPage();
    const { result } = renderHook(() => useParkSelectionWhileDragging());
    result.current.onDragStart(undefined);
    expect(document.querySelector("[inert]")).toBeNull();
    expect(shield.isConnected).toBe(true);
  });
});
