import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagEditor } from "../../../../components/notes/TagEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "notes.addTag") return "Add tag";
      if (key === "common.add") return "Add";
      return key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("TagEditor", () => {
  it("renders the tag combobox immediately", () => {
    render(<TagEditor tags={[]} allTags={["draft"]} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("adds an existing tag from the options", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <TagEditor tags={["draft"]} allTags={["draft", "ideas", "research"]} onChange={onChange} />
    );

    await user.type(screen.getByRole("combobox"), "ide");
    await user.click(await screen.findByRole("button", { name: "ideas" }));

    expect(onChange).toHaveBeenCalledWith(["draft", "ideas"]);
  });

  it("marks already-selected tags in the options", async () => {
    const user = userEvent.setup();

    render(<TagEditor tags={["draft"]} allTags={["draft", "ideas"]} onChange={vi.fn()} />);

    await user.click(screen.getByRole("combobox"));
    await screen.findByText("ideas");
    expect(screen.getByRole("checkbox", { name: "draft" })).toBeChecked();
  });

  it("creates a new tag via the Enter key and collapses back to the add button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor tags={["draft"]} allTags={["draft"]} onChange={onChange} />);

    await user.type(screen.getByRole("combobox"), "plot{Enter}");

    expect(onChange).toHaveBeenCalledWith(["draft", "plot"]);
  });

  it("ignores adding a tag that is already selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<TagEditor tags={["draft"]} allTags={["draft"]} onChange={onChange} />);

    await user.type(screen.getByRole("combobox"), "draft{Enter}");

    expect(onChange).not.toHaveBeenCalled();
  });
});
