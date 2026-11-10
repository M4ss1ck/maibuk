import { describe, expect, it } from "vitest";

import { isTypingEvent, isTypingTarget, markTypingEvent } from "@/lib/keyboard";

function input(type?: string): HTMLInputElement {
  const element = document.createElement("input");
  if (type !== undefined) element.type = type;
  return element;
}

describe("isTypingTarget()", () => {
  it.each([
    "checkbox",
    "button",
    "submit",
    "reset",
    "color",
    "file",
  ])("treats <input type=%s> as a control, not a typing target", (type) => {
    expect(isTypingTarget(input(type))).toBe(false);
  });

  it.each(["text", "radio", "range"])("treats <input type=%s> as a typing target", (type) => {
    expect(isTypingTarget(input(type))).toBe(true);
  });

  it("treats an input with no type as a text typing target", () => {
    expect(isTypingTarget(input())).toBe(true);
  });

  it("treats a textarea as a typing target", () => {
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
  });

  it("treats a select as a typing target", () => {
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("treats a contenteditable element as a typing target", () => {
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isTypingTarget(editable)).toBe(true);
  });
});

describe("isTypingEvent()", () => {
  it("is false for a key event with no typing target", () => {
    expect(isTypingEvent(new KeyboardEvent("keydown"))).toBe(false);
  });

  it("is true once the host marks a replayed key event", () => {
    const event = new KeyboardEvent("keydown");
    markTypingEvent(event);
    expect(isTypingEvent(event)).toBe(true);
  });

  it("falls back to the event's own target", () => {
    const event = new KeyboardEvent("keydown");
    Object.defineProperty(event, "target", { value: document.createElement("textarea") });
    expect(isTypingEvent(event)).toBe(true);
  });
});
