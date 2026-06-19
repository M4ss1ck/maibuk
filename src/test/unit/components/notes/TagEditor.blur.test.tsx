import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TagEditor } from "../../../../components/notes/TagEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
}));

describe("TagEditor blur behavior", () => {
  it("dismisses the add tag input when focus leaves the tag editor", async () => {
    const user = userEvent.setup();

    render(
      <>
        <TagEditor tags={[]} allTags={["draft"]} onChange={vi.fn()} />
        <button type="button">Outside</button>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "+ common.add" }));

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
