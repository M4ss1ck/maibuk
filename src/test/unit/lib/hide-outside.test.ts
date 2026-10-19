import { afterEach, describe, expect, it } from "vitest";
import { hideOutsidePortal } from "@/lib/hide-outside";

// Hiding with `aria-hidden` is what assistive technology reads; the overlay's
// underlay blocks the pointer and FocusScope keeps Tab inside the dialog.

function portalWithSiblings() {
  const root = document.createElement("div");
  root.id = "root";
  const app = document.createElement("main");
  root.append(app);
  const portal = document.createElement("div");
  portal.setAttribute("role", "dialog");
  document.body.append(root, portal);
  return { root, app, portal };
}

const isHidden = (element: Element) => element.getAttribute("aria-hidden") === "true";

afterEach(() => {
  document.body.replaceChildren();
});

describe("hideOutsidePortal()", () => {
  it("hides each body child beside the portal, and releases it", () => {
    const { root, portal } = portalWithSiblings();
    const release = hideOutsidePortal(portal);

    expect(isHidden(root)).toBe(true);
    expect(isHidden(portal)).toBe(false);
    expect(portal.closest('[aria-hidden="true"]')).toBeNull();

    release();
    expect(root.hasAttribute("aria-hidden")).toBe(false);
  });

  it("keeps a live announcer and a top-layer element visible", () => {
    const { root, portal } = portalWithSiblings();
    const announcer = document.createElement("div");
    announcer.setAttribute("data-live-announcer", "true");
    const toast = document.createElement("div");
    toast.setAttribute("data-react-aria-top-layer", "true");
    document.body.append(announcer, toast);

    const release = hideOutsidePortal(portal);
    expect(isHidden(root)).toBe(true);
    expect(isHidden(announcer)).toBe(false);
    expect(isHidden(toast)).toBe(false);
    release();
  });

  it("descends to keep a live announcer nested beside the page's screens reachable", () => {
    const { root, portal } = portalWithSiblings();
    const shell = document.createElement("div");
    const screen = document.createElement("main");
    const announcer = document.createElement("div");
    announcer.setAttribute("data-live-announcer", "true");
    shell.append(screen, announcer);
    root.append(shell);

    const release = hideOutsidePortal(portal);
    expect(isHidden(root)).toBe(false);
    expect(isHidden(shell)).toBe(false);
    expect(isHidden(screen)).toBe(true);
    expect(isHidden(announcer)).toBe(false);

    release();
    expect(screen.hasAttribute("aria-hidden")).toBe(false);
  });

  it("keeps the page hidden while a second overlay is still open", () => {
    const { root, portal: first } = portalWithSiblings();
    const second = document.createElement("div");
    second.setAttribute("role", "dialog");
    document.body.append(second);

    const releaseFirst = hideOutsidePortal(first);
    const releaseSecond = hideOutsidePortal(second);

    expect(isHidden(root)).toBe(true);
    releaseSecond();
    expect(isHidden(root)).toBe(true);
    expect(isHidden(first)).toBe(false);

    releaseFirst();
    expect(isHidden(root)).toBe(false);
  });

  it("never removes an aria-hidden another author set", () => {
    const { root, portal } = portalWithSiblings();
    root.setAttribute("aria-hidden", "true");

    const release = hideOutsidePortal(portal);
    expect(isHidden(root)).toBe(true);
    release();
    expect(isHidden(root)).toBe(true);
  });

  it("can be released more than once", () => {
    const { root, portal } = portalWithSiblings();
    const release = hideOutsidePortal(portal);

    release();
    release();
    expect(isHidden(root)).toBe(false);
  });

  it("does nothing when the portal is not under the body", () => {
    const { root } = portalWithSiblings();
    const detached = document.createElement("div");

    const release = hideOutsidePortal(detached);
    expect(isHidden(root)).toBe(false);
    release();
    expect(isHidden(root)).toBe(false);
  });
});
