import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeViewProps } from "@tiptap/react";
import type { ComponentProps, ElementType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageView } from "@/components/editor/ImageView";

const { createNodeSelection } = vi.hoisted(() => ({ createNodeSelection: vi.fn() }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    as: Tag = "div",
    children,
    ...props
  }: {
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
      return {
        x: 0,
        y: 0,
        width,
        height: 100,
        top: 0,
        right: width,
        bottom: 100,
        left: 0,
        toJSON: () => ({}),
      };
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

  it.each([
    "pointerCancel",
    "lostPointerCapture",
  ] as const)("cleans an interrupted resize after %s without committing it", (eventName) => {
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
  });

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

  it("leaves an IME Enter in the image caption for the IME", () => {
    renderImage();
    const caption = document.querySelector(".image-caption");
    if (!(caption instanceof HTMLElement)) throw new Error("Missing image caption");

    // An IME's Enter must not be swallowed: the composition needs it to commit.
    expect(fireEvent.keyDown(caption, { key: "Enter", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(caption, { key: "Enter", keyCode: 229 })).toBe(true);

    // The author's Enter still never starts a new line in the caption.
    expect(fireEvent.keyDown(caption, { key: "Enter" })).toBe(false);
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

  const unsized = (width: unknown, alignment = "center") =>
    createProps({
      node: {
        attrs: { src: "data:image/png;base64,test", width, alignment },
        textContent: "",
      } as unknown as NodeViewProps["node"],
    });

  // A pasted 64px picture once filled the page: a figure with no width of its
  // own drew at 100%. It draws at the picture's own width, which CSS caps at
  // the page (.natural-width in index.css).
  it.each([
    null,
    "auto",
    "malformed",
    42,
  ])("draws a %s width at the picture's own size", (width) => {
    renderImage(unsized(width));

    const figure = document.querySelector("figure");
    expect(figure).toHaveClass("natural-width");
    expect(figure?.style.width).toBe("");
  });

  it("gives a resized picture its stored width", () => {
    renderImage();

    const figure = document.querySelector("figure");
    expect(figure).not.toHaveClass("natural-width");
    expect(figure).toHaveStyle({ width: "50%" });
  });

  // jsdom never loads a picture; mark it loaded so its drawn width counts.
  function loadPicture() {
    const picture = document.querySelector("img");
    if (!picture) throw new Error("Missing picture");
    Object.defineProperty(picture, "complete", { configurable: true, value: true });
    Object.defineProperty(picture, "naturalWidth", { configurable: true, value: 64 });
    fireEvent.load(picture);
  }

  function drawFigureAt(width: number) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      const isPage =
        this.classList.contains("editor-content") || this.classList.contains("ProseMirror");
      const w = isPage ? 1000 : width;
      return {
        x: 0,
        y: 0,
        width: w,
        height: 100,
        top: 0,
        right: w,
        bottom: 100,
        left: 0,
        toJSON: () => ({}),
      };
    });
  }

  it.each([
    null,
    "auto",
    "malformed",
    42,
  ])("steps a %s width from the size the picture is drawn at", async (width) => {
    const user = userEvent.setup();
    const props = unsized(width);
    renderImage(props);
    loadPicture();

    // The picture is drawn 500px wide on a 1000px page: 50%.
    const decrease = screen.getByRole("button", { name: "editor.decreaseImageWidth" });
    const increase = screen.getByRole("button", { name: "editor.increaseImageWidth" });
    expect(decrease).toBeEnabled();
    expect(increase).toBeEnabled();
    decrease.focus();
    await user.keyboard("{Enter}");

    expect(props.updateAttributes).toHaveBeenCalledWith({ width: "40%" });
  });

  it("does not grow an unsized picture already as wide as the page", () => {
    drawFigureAt(1000);
    renderImage(unsized(null));
    loadPicture();

    expect(screen.getByRole("button", { name: "editor.increaseImageWidth" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "editor.decreaseImageWidth" })).toBeEnabled();
  });

  // A 64px picture on a 1000px page is drawn at 6%: smaller than a step allows,
  // so it cannot shrink, and growing starts from 6%, not from the 10% floor.
  it("grows a picture smaller than the minimum one step from its own size", async () => {
    drawFigureAt(64);
    const user = userEvent.setup();
    const props = unsized(null);
    renderImage(props);
    loadPicture();

    expect(screen.getByRole("button", { name: "editor.decreaseImageWidth" })).toBeDisabled();
    screen.getByRole("button", { name: "editor.increaseImageWidth" }).focus();
    await user.keyboard("{Enter}");

    expect(props.updateAttributes).toHaveBeenCalledWith({ width: "16%" });
  });

  it("offers no width step before an unsized picture has loaded", () => {
    renderImage(unsized(null));

    expect(screen.getByRole("button", { name: "editor.decreaseImageWidth" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "editor.increaseImageWidth" })).toBeDisabled();
  });

  // A centered picture grows on both sides, so a corner drag counts twice; a
  // picture pinned to one side grows only on the dragged side.
  it.each([
    ["left", "se", 50, "55%"],
    ["right", "sw", -50, "55%"],
    ["center", "se", 50, "60%"],
  ])("follows the pointer when resizing a %s-aligned picture", (alignment, corner, dx, expected) => {
    const { props } = renderImage(unsized("50%", alignment));
    const handle = document.querySelector(`.image-resize-handle.${corner}`) as HTMLElement;
    installPointerCapture(handle);

    fireEvent.pointerDown(handle, { pointerId: 11, pointerType: "touch", clientX: 0 });
    fireEvent.pointerMove(document, { pointerId: 11, pointerType: "touch", clientX: dx });
    fireEvent.pointerUp(document, { pointerId: 11, pointerType: "touch", clientX: dx });

    expect(props.updateAttributes).toHaveBeenCalledWith({ width: expected });
  });
});
