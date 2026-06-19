import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NoteTagsRow } from "../../../../components/notes/NoteTagsRow";

describe("NoteTagsRow", () => {
  it("reveals hidden overflow tags from the +N chip", async () => {
    const user = userEvent.setup();

    render(
      <NoteTagsRow
        tags={["draft", "ideas", "research"]}
        dateLabel="Edited today"
      />,
    );

    expect(screen.getAllByText("ideas")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "+2" }));

    expect(screen.getAllByText("ideas").length).toBeGreaterThan(1);
    expect(screen.getAllByText("research").length).toBeGreaterThan(1);
  });
});
