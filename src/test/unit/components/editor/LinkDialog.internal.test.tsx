// src/test/unit/components/editor/LinkDialog.internal.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LinkDialog } from "../../../../components/editor/LinkDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const setLink = vi.fn(() => ({ run: vi.fn() }));
const focus = vi.fn(() => ({ setLink }));
const chain = vi.fn(() => ({ focus }));

const editor = {
  state: {
    selection: { from: 1, to: 5 },
    doc: { textBetween: () => "anchor" },
  },
  getAttributes: () => ({}),
  chain,
} as unknown as import("@tiptap/react").Editor;

describe("LinkDialog internal target picker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a maibuk chapter link when a chapter is chosen", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "chapter",
            chapterId: "c1",
            title: "Chapter One",
            headingId: null,
          },
          {
            type: "heading",
            chapterId: "c1",
            title: "A Section",
            headingId: "h-1",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("Chapter One"));

    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://chapter/c1" });
  });

  it("inserts a maibuk heading link when a heading is chosen", () => {
    render(
      <LinkDialog
        editor={editor}
        isOpen
        onClose={() => {}}
        bookId="b1"
        internalTargets={[
          {
            type: "heading",
            chapterId: "c1",
            title: "A Section",
            headingId: "h-1",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByText("editor.linkInThisBook"));
    fireEvent.click(screen.getByText("A Section"));
    expect(setLink).toHaveBeenCalledWith({ href: "maibuk://heading/c1/h-1" });
  });
});
