import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Editor } from "@tiptap/core";
import { ChapterOutline } from "@/components/editor/ChapterOutline";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeEditor(headings: { level: number; text: string }[]): Editor {
  const nodes = headings.map((h) => ({
    type: { name: "heading" },
    attrs: { level: h.level },
    textContent: h.text,
  }));
  return {
    state: {
      doc: {
        forEach: (cb: (node: unknown, offset: number) => void) =>
          nodes.forEach((node, index) => cb(node, index)),
      },
      selection: { from: 0 },
    },
    on: () => {},
    off: () => {},
    view: { nodeDOM: () => null },
    commands: { setTextSelection: () => {} },
  } as unknown as Editor;
}

describe("ChapterOutline", () => {
  it("moves focus between headings with ArrowDown/ArrowUp and clamps at the ends", async () => {
    const user = userEvent.setup();
    render(
      <ChapterOutline
        editor={makeEditor([
          { level: 1, text: "One" },
          { level: 1, text: "Two" },
          { level: 1, text: "Three" },
        ])}
      />
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);

    buttons[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(buttons[1]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(buttons[2]).toHaveFocus();

    // Clamps at the last heading instead of scrolling away.
    await user.keyboard("{ArrowDown}");
    expect(buttons[2]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(buttons[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(buttons[0]).toHaveFocus();

    // Clamps at the first heading.
    await user.keyboard("{ArrowUp}");
    expect(buttons[0]).toHaveFocus();
  });
});
