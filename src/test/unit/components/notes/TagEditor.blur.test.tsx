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
  it("notifies when the open tag combobox is dismissed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <>
        <TagEditor tags={[]} allTags={["draft"]} onChange={vi.fn()} onClose={onClose} />
        <button type="button">Outside</button>
      </>
    );

    expect(screen.getByRole("combobox")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Outside" }));

    expect(onClose).toHaveBeenCalled();
  });
});
