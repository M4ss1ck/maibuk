import { createRef } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WikilinkList, type WikilinkListHandle } from "@/components/editor/WikilinkSuggestion";
import type { WikilinkCandidate } from "@/features/links/wikilink-targets";

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key}:${options.title}` : key,
  },
}));

// jsdom has no scrollIntoView.
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

const ITEMS: WikilinkCandidate[] = [
  { kind: "note", id: "n1", label: "Keeper's Log" },
  { kind: "book", id: "b1", label: "The Lighthouse Keeper" },
];

describe("WikilinkList", () => {
  it("is a named listbox whose active option is aria-selected", async () => {
    const ref = createRef<WikilinkListHandle>();
    render(<WikilinkList ref={ref} items={ITEMS} command={vi.fn()} />);

    const listbox = screen.getByRole("listbox", { name: "editor.linkSuggestions" });
    expect(listbox).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Keeper's Log");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
  });

  it("moves the active option with the arrow keys forwarded from the editor", () => {
    const ref = createRef<WikilinkListHandle>();
    render(<WikilinkList ref={ref} items={ITEMS} command={vi.fn()} />);

    act(() => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowDown" }) });
    });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");

    act(() => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowUp" }) });
    });
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  // The list is capped in height; arrows moved past its fold without scrolling.
  it("scrolls the active option into view as the arrows move it", () => {
    const ref = createRef<WikilinkListHandle>();
    const many: WikilinkCandidate[] = Array.from({ length: 9 }, (_, n) => ({
      kind: "note",
      id: `n${n}`,
      label: `Buoy ${n}`,
    }));
    render(<WikilinkList ref={ref} items={many} command={vi.fn()} />);
    scrollIntoView.mockClear();

    act(() => {
      ref.current?.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowUp" }) });
    });

    const last = screen.getByRole("option", { name: /Buoy 8/ });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(last);
  });

  it("offers creating a note from the typed label", () => {
    render(<WikilinkList items={[{ kind: "createNote", label: "New Idea" }]} command={vi.fn()} />);

    expect(
      screen.getByRole("option", { name: /editor.createNoteFromWikilink:New Idea/ })
    ).toBeInTheDocument();
  });
});
