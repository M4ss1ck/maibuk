import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { Editor } from "@/components/editor/Editor";

// useEditor destroys a new editor on a 1 ms timer unless its effect has run. In
// a time-sliced render (a lazy route's Suspense retry) the timer fires first, and
// the page went blank. This fires it at the same point, deterministically.
vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  let timerFired = false;
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args);
      if (editor && !timerFired) {
        timerFired = true;
        editor.destroy();
      }
      return editor;
    },
  };
});

vi.mock("@/features/settings/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/settings/store")>();
  const state = () => ({ ...actual.useSettingsStore.getState(), spellCheckEnabled: false });
  return {
    ...actual,
    useSettingsStore: Object.assign(
      (selector: (s: ReturnType<typeof state>) => unknown) => selector(state()),
      actual.useSettingsStore,
      { getState: state }
    ),
  };
});

it("mounts a working editor when the first one is destroyed before its effects run", async () => {
  render(
    <MemoryRouter>
      <Editor content="<p>Still here</p>" onUpdate={vi.fn()} ariaLabel="Text" />
    </MemoryRouter>
  );

  expect(await screen.findByRole("textbox", { name: "Text" })).toHaveTextContent("Still here");
});
