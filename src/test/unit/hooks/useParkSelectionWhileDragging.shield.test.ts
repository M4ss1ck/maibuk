import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// The keyboard-or-pointer input kind is set by real key and pointer presses in
// ChapterList.test.tsx and drag-inert.test.ts; this file only controls it.
const { mockPark, mockKeyboard } = vi.hoisted(() => ({
  mockPark: vi.fn(),
  mockKeyboard: { value: true },
}));
vi.mock("@/lib/park-selection", () => ({ parkInertSelection: mockPark }));
vi.mock("@/lib/drag-inert", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drag-inert")>()),
  dragStartedByKeyboard: () => mockKeyboard.value,
}));

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
  mockKeyboard.value = true;
});

describe("useParkSelectionWhileDragging() editor shield", () => {
  it("releases the shield when the drag ends", () => {
    const { list, shield } = buildPage();
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    expect(shield.hasAttribute("inert")).toBe(true);
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

  it("a second drag start without an end releases the first shield, so nothing stays inert", () => {
    const { list, shield } = buildPage();
    const { result } = renderHook(() =>
      useParkSelectionWhileDragging({ shieldEditorFrom: () => list })
    );
    result.current.onDragStart(undefined);
    result.current.onDragStart(undefined);
    result.current.onDragEnd(undefined);
    expect(shield.hasAttribute("inert")).toBe(false);
    expect(document.querySelector("[inert]")).toBeNull();
  });

  it("leaves a native pointer drag alone (React Aria starts no session for it)", () => {
    const { list, shield } = buildPage();
    mockKeyboard.value = false;
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
