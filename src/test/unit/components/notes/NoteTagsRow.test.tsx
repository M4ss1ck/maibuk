import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteTagsRow } from "../../../../components/notes/NoteTagsRow";

describe("NoteTagsRow", () => {
  let clientWidthSpy: ReturnType<typeof vi.spyOn>;
  let offsetWidthSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clientWidthSpy = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    offsetWidthSpy = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    offsetWidthSpy.mockImplementation(function getOffsetWidth(this: HTMLElement) {
      const text = this.textContent ?? "";
      if (text === "Edited today") return 70;
      if (text === "Add tag") return 36;
      if (text === "research") return 56;
      if (text.startsWith("+")) return 20;
      return 36;
    });
  });

  afterEach(() => {
    clientWidthSpy.mockRestore();
    offsetWidthSpy.mockRestore();
  });

  it("reveals hidden overflow tags from the +N chip", async () => {
    const user = userEvent.setup();
    clientWidthSpy.mockReturnValue(140);

    render(<NoteTagsRow tags={["draft", "ideas", "research"]} dateLabel="Edited today" />);

    expect(screen.getAllByText("ideas")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "+2" }));

    expect(screen.getAllByText("ideas").length).toBeGreaterThan(1);
    expect(screen.getAllByText("research").length).toBeGreaterThan(1);
  });

  it("does not force a visible tag when only the date and overflow count fit", async () => {
    clientWidthSpy.mockReturnValue(75);

    render(<NoteTagsRow tags={["draft", "ideas", "research"]} dateLabel="Edited today" />);

    expect(await screen.findByRole("button", { name: "+3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+2" })).not.toBeInTheDocument();
  });

  it("accounts for the action slot between the date and tags", async () => {
    clientWidthSpy.mockReturnValue(135);

    render(
      <NoteTagsRow
        tags={["draft", "ideas", "research"]}
        dateLabel="Edited today"
        datePosition="left"
        action={<button type="button">Add tag</button>}
      />
    );

    const row = screen.getAllByText("Edited today")[0].parentElement;

    expect(row?.textContent).toMatch(/^Edited todayAdd tag/);
    expect(await screen.findByRole("button", { name: "+3" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+2" })).not.toBeInTheDocument();
  });
});
