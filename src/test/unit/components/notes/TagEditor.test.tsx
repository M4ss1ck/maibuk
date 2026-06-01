import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagEditor } from "../../../../components/notes/TagEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { name?: string }) => {
      if (key === "notes.tags") return "Tags";
      if (key === "notes.createTag") return `Create "${params?.name ?? ""}"`;
      return key;
    },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("TagEditor", () => {
  it("toggles existing tags and allows creating a new tag", () => {
    const onChange = vi.fn();

    render(
      <div>
        <TagEditor
          tags={["draft"]}
          allTags={["draft", "ideas", "research"]}
          onChange={onChange}
        />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "ideas" }));
    expect(onChange).toHaveBeenCalledWith(["draft", "ideas"]);

    fireEvent.click(screen.getByRole("button", { name: "draft" }));
    expect(onChange).toHaveBeenCalledWith([]);

    fireEvent.change(screen.getByPlaceholderText("Tags"), {
      target: { value: "plot" },
    });

    fireEvent.click(screen.getByRole("button", { name: 'Create "plot"' }));
    expect(onChange).toHaveBeenCalledWith(["draft", "plot"]);
  });

  it("closes when clicking outside", () => {
    const onClose = vi.fn();

    render(
      <div>
        <TagEditor
          tags={[]}
          allTags={["draft"]}
          onChange={vi.fn()}
          onClose={onClose}
        />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
