import { afterEach, describe, expect, it } from "vitest";
import { dragStartedByKeyboard, inertEditorOutside } from "@/lib/drag-inert";

// jsdom has no `inert` reflection; the attribute is what browsers honour and
// what park-selection's `closest("[inert]")` reads, so tests use the attribute.
function buildPage() {
  const app = document.createElement("div");
  app.id = "app";
  const pane = document.createElement("section");
  const list = document.createElement("ul");
  list.setAttribute("data-testid", "list");
  pane.append(list);
  const shell = document.createElement("main");
  const wrapper = document.createElement("div");
  wrapper.setAttribute("data-testid", "editor-wrapper");
  const editor = document.createElement("div");
  editor.className = "ProseMirror";
  editor.setAttribute("contenteditable", "true");
  wrapper.append(editor);
  shell.append(wrapper);
  app.append(pane, shell);
  document.body.append(app);
  return { list, wrapper, editor };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("inertEditorOutside()", () => {
  it("makes the top-most editor ancestor that does not contain the list inert", () => {
    const { list, wrapper } = buildPage();
    const release = inertEditorOutside(list);
    expect(wrapper.closest("main")!.hasAttribute("inert")).toBe(true);
    expect(wrapper.hasAttribute("inert")).toBe(false);
    expect(list.closest("[inert]")).toBeNull();
    release();
  });

  it("removes only the inert it set, when released", () => {
    const { list, editor } = buildPage();
    const shield = editor.closest("main")!;
    const release = inertEditorOutside(list);
    expect(shield.hasAttribute("inert")).toBe(true);
    release();
    expect(shield.hasAttribute("inert")).toBe(false);
  });

  it("never removes an inert that someone else set", () => {
    const { list, editor } = buildPage();
    const shield = editor.closest("main")!;
    shield.setAttribute("inert", "");
    const release = inertEditorOutside(list);
    release();
    expect(shield.hasAttribute("inert")).toBe(true);
  });

  it("does nothing when the editor is already inside an inert subtree", () => {
    const { list, editor } = buildPage();
    editor.closest("div")!.setAttribute("inert", "");
    const release = inertEditorOutside(list);
    expect(document.querySelectorAll("[inert]")).toHaveLength(1);
    release();
    expect(document.querySelectorAll("[inert]")).toHaveLength(1);
  });

  it("does nothing when there is no editor on the page", () => {
    const list = document.createElement("ul");
    document.body.append(list);
    const release = inertEditorOutside(list);
    expect(document.querySelector("[inert]")).toBeNull();
    release();
  });

  it("does nothing when the list is inside the editor", () => {
    const { editor } = buildPage();
    const nested = document.createElement("ul");
    editor.append(nested);
    const release = inertEditorOutside(nested);
    expect(document.querySelector("[inert]")).toBeNull();
    release();
  });

  it("releasing twice removes nothing more", () => {
    const { list, editor } = buildPage();
    const shield = editor.closest("main")!;
    const release = inertEditorOutside(list);
    release();
    shield.setAttribute("inert", "");
    release();
    expect(shield.hasAttribute("inert")).toBe(true);
  });
});

describe("dragStartedByKeyboard()", () => {
  it("is false when the last input was a pointer press after a key press", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.dispatchEvent(new Event("pointerdown"));
    expect(dragStartedByKeyboard()).toBe(false);
  });

  it("is true when the last input was a key press after a pointer press", () => {
    document.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(dragStartedByKeyboard()).toBe(true);
  });
});
