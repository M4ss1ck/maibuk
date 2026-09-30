import { afterEach, describe, expect, it } from "vitest";
import { tutorialTargetSelector } from "@/components/tutorial/TutorialRunner";

// A step's anchor is a token list: one element can carry several step ids, and
// a selector matches a whole token, never a prefix of one.

describe("tutorialTargetSelector()", () => {
  afterEach(() => {
    for (const element of document.querySelectorAll("[data-tutorial]")) element.remove();
  });

  it("matches an element by any id in its token list", () => {
    const element = document.createElement("button");
    element.setAttribute("data-tutorial", "settings.shortcuts dictation.voice-commands");
    document.body.appendChild(element);

    expect(document.querySelector(tutorialTargetSelector("settings.shortcuts"))).toBe(element);
    expect(document.querySelector(tutorialTargetSelector("dictation.voice-commands"))).toBe(
      element
    );
  });

  it("does not match a prefix of a token", () => {
    const element = document.createElement("button");
    element.setAttribute("data-tutorial", "settings.shortcuts dictation.voice-commands");
    document.body.appendChild(element);

    expect(document.querySelector(tutorialTargetSelector("settings.shortcut"))).toBeNull();
    expect(document.querySelector(tutorialTargetSelector("dictation.voice"))).toBeNull();
    expect(document.querySelector(tutorialTargetSelector("settings"))).toBeNull();
  });

  it("matches nothing when the id is absent", () => {
    expect(document.querySelector(tutorialTargetSelector("books.gallery"))).toBeNull();
  });
});
