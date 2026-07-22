import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeViewProps } from "@tiptap/react";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageView } from "@/components/editor/ImageView";

const { createNodeSelection } = vi.hoisted(() => ({ createNodeSelection: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ as: Tag = "div", children, ...props }: {
    as?: ElementType;
    children?: ReactNode;
  } & Record<string, unknown>) => <Tag {...props}>{children}</Tag>,
  NodeViewContent: (props: ComponentProps<"div">) => <div {...props} />,
}));

vi.mock("@tiptap/pm/state", () => ({
  NodeSelection: { create: createNodeSelection },
}));

vi.mock("@/components/ui", async () => {
  const actual = await vi.importActual<typeof import("@/components/ui")>("@/components/ui");
  return {
    ...actual,
    Tooltip: ({ children }: { children: ReactNode }) => children,
  };
});

function createProps(overrides: Partial<NodeViewProps> = {}): NodeViewProps {
  const transaction = { setSelection: vi.fn(() => transaction) };
  return {
    node: {
      attrs: { src: "data:image/png;base64,test", width: "50%", alignment: "center" },
      textContent: "",
    },
    editor: {
      isEditable: true,
      state: { doc: {}, tr: transaction },
      view: { dispatch: vi.fn() },
    },
    getPos: () => 4,
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    selected: true,
    ...overrides,
  } as unknown as NodeViewProps;
}

function renderImage(props = createProps(), contentRootClass = "editor-content") {
  const result = render(
    <div className={contentRootClass}>
      <ImageView {...props} />
    </div>
  );
  return { ...result, props };
}

function installPointerCapture(handle: Element) {
  let captured = false;
  const setPointerCapture = vi.fn(() => {
    captured = true;
  });
  const releasePointerCapture = vi.fn(() => {
    captured = false;
  });
  Object.defineProperties(handle, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    hasPointerCapture: { configurable: true, value: () => captured },
  });
  return { setPointerCapture, releasePointerCapture };
}

function southeastHandle(): HTMLElement {
  const handle = document.querySelector(".image-resize-handle.se");
  if (!(handle instanceof HTMLElement)) throw new Error("Missing southeast resize handle");
  return handle;
}

describe("ImageView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNodeSelection.mockReturnValue({ selection: "image" });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const width =
        this.classList.contains("editor-content") || this.classList.contains("ProseMirror")
          ? 1000
          : 500;
      return { x: 0, y: 0, width, height: 100, top: 0, right: width, bottom: 100, left: 0, toJSON: () => ({}) };
    });
  });

  it.each([
    ["primary mouse", { pointerType: "mouse", button: 0 }],
    ["touch", { pointerType: "touch", button: 0 }],
  ])("selects the image with a %s pointer", (_label, pointer) => {
    const { props } = renderImage();

    fireEvent.pointerDown(document.querySelector(".image-view-container")!, pointer);

    expect(createNodeSelection).toHaveBeenCalledWith(props.editor.state.doc, 4);
    expect(props.editor.view.dispatch).toHaveBeenCalledOnce();
  });

  it("preserves non-primary mouse behavior", () => {
    const { props } = renderImage();

    fireEvent.pointerDown(document.querySelector(".image-view-container")!, {
      pointerType: "mouse",
      button: 2,
    });

    expect(createNodeSelection).not.toHaveBeenCalled();
    expect(props.editor.view.dispatch).not.toHaveBeenCalled();
  });

  it("captures the pointer and commits the resized width on pointerup", () => {
    const { props } = renderImage();
    const handle = southeastHandle();
    const capture = installPointerCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 7, pointerType: "touch", clientX: 0 });
    fireEvent.pointerMove(document, { pointerId: 7, pointerType: "touch", clientX: 50 });
    fireEvent.pointerUp(document, { pointerId: 7, pointerType: "touch", clientX: 50 });

    expect(capture.setPointerCapture).toHaveBeenCalledWith(7);
    expect(props.updateAttributes).toHaveBeenCalledWith({ width: "60%" });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("resizes against a ProseMirror content root without jumping toward full width", () => {
    const { props } = renderImage(createProps(), "ProseMirror");
    const handle = southeastHandle();
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 10, pointerType: "touch", clientX: 0 });
    fireEvent.pointerMove(document, { pointerId: 10, pointerType: "touch", clientX: 50 });
    fireEvent.pointerUp(document, { pointerId: 10, pointerType: "touch", clientX: 50 });

    expect(props.updateAttributes).toHaveBeenCalledWith({ width: "60%" });
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)(
    "cleans an interrupted resize after %s without committing it",
    (eventName) => {
      const { props } = renderImage();
      const handle = southeastHandle();
      installPointerCapture(handle);

      fireEvent.pointerDown(handle, { pointerId: 8, pointerType: "touch", clientX: 0 });
      fireEvent.pointerMove(document, { pointerId: 8, pointerType: "touch", clientX: 50 });
      fireEvent[eventName](eventName === "pointerCancel" ? document : handle, {
        pointerId: 8,
        pointerType: "touch",
      });
      fireEvent.pointerUp(document, { pointerId: 8, pointerType: "touch", clientX: 100 });

      expect(props.updateAttributes).not.toHaveBeenCalled();
      expect(document.body.style.cursor).toBe("");
      expect(document.body.style.userSelect).toBe("");
      expect(document.querySelector("figure")).toHaveStyle({ width: "50%" });
    }
  );

  it("cleans an active resize when unmounted", () => {
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    const { props, unmount } = renderImage();
    const handle = southeastHandle();
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 9, pointerType: "touch", clientX: 0 });
    expect(document.body.style.userSelect).toBe("none");

    unmount();
    fireEvent.pointerMove(document, { pointerId: 9, pointerType: "touch", clientX: 50 });
    fireEvent.pointerUp(document, { pointerId: 9, pointerType: "touch", clientX: 50 });

    expect(props.updateAttributes).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("cancels an overlapping instance and restores the original global body styles", () => {
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "text";
    const firstProps = createProps();
    const secondProps = createProps();
    render(
      <div className="editor-content">
        <ImageView {...firstProps} />
        <ImageView {...secondProps} />
      </div>
    );
    const handles = document.querySelectorAll<HTMLElement>(".image-resize-handle.se");
    installPointerCapture(handles[0]);
    installPointerCapture(handles[1]);

    fireEvent.pointerDown(handles[0], { pointerId: 11, pointerType: "touch", clientX: 0 });
    fireEvent.pointerMove(document, { pointerId: 11, pointerType: "touch", clientX: 50 });
    fireEvent.pointerDown(handles[1], { pointerId: 12, pointerType: "touch", clientX: 0 });
    fireEvent.pointerUp(document, { pointerId: 11, pointerType: "touch", clientX: 50 });
    fireEvent.pointerCancel(document, { pointerId: 12, pointerType: "touch" });

    expect(firstProps.updateAttributes).not.toHaveBeenCalled();
    expect(secondProps.updateAttributes).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("changes image width with the localized keyboard controls", async () => {
    const user = userEvent.setup();
    const { props } = renderImage();
    const decrease = screen.getByRole("button", { name: "editor.decreaseImageWidth" });
    const increase = screen.getByRole("button", { name: "editor.increaseImageWidth" });

    decrease.focus();
    await user.keyboard("{Enter}");
    increase.focus();
    await user.keyboard(" ");

    expect(props.updateAttributes).toHaveBeenNthCalledWith(1, { width: "40%" });
    expect(props.updateAttributes).toHaveBeenNthCalledWith(2, { width: "60%" });
  });

  it("moves toolbar focus horizontally and activates the focused alignment", async () => {
    const user = userEvent.setup();
    const { props } = renderImage();
    const left = screen.getByRole("button", { name: "editor.alignLeft" });
    const center = screen.getByRole("button", { name: "editor.alignCenter" });
    const right = screen.getByRole("button", { name: "editor.alignRight" });

    center.focus();
    await user.keyboard("{ArrowRight}");
    expect(right).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(props.updateAttributes).toHaveBeenLastCalledWith({ alignment: "right" });

    await user.keyboard("{ArrowLeft}");
    expect(center).toHaveFocus();
    await user.keyboard(" ");
    expect(props.updateAttributes).toHaveBeenLastCalledWith({ alignment: "center" });
    expect(left).not.toHaveFocus();
  });

  it.each([
    ["10%", "editor.decreaseImageWidth"],
    ["100%", "editor.increaseImageWidth"],
  ])("disables %s-bound updates from %s", async (width, label) => {
    const user = userEvent.setup();
    const props = createProps({
      node: {
        attrs: { src: "data:image/png;base64,test", width, alignment: "center" },
        textContent: "",
      } as unknown as NodeViewProps["node"],
    });
    renderImage(props);

    const button = screen.getByRole("button", { name: label });
    expect(button).toBeDisabled();
    button.focus();
    await user.keyboard("{Enter}");

    expect(props.updateAttributes).not.toHaveBeenCalled();
  });

  it.each([null, "auto", "malformed", 42])(
    "normalizes a %s persisted width before a keyboard change",
    async (width) => {
      const user = userEvent.setup();
      const props = createProps({
        node: {
          attrs: { src: "data:image/png;base64,test", width, alignment: "center" },
          textContent: "",
        } as unknown as NodeViewProps["node"],
      });
      renderImage(props);

      const decrease = screen.getByRole("button", { name: "editor.decreaseImageWidth" });
      const increase = screen.getByRole("button", { name: "editor.increaseImageWidth" });
      expect(decrease).toBeEnabled();
      expect(increase).toBeDisabled();
      decrease.focus();
      await user.keyboard("{Enter}");

      expect(props.updateAttributes).toHaveBeenCalledWith({ width: "90%" });
    }
  );
});
