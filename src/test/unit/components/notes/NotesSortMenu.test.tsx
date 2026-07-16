import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotesSortMenu } from "@/components/notes/NotesSortMenu";

const translations: Record<string, string> = {
  "notes.sortBy": "Sort by",
  "notes.sortDateNewest": "Newest first",
  "notes.sortDateOldest": "Oldest first",
  "notes.sortTitleAsc": "Title A–Z",
  "notes.sortTitleDesc": "Title Z–A",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

describe("NotesSortMenu", () => {
  it("selects the next sort option with the keyboard", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<NotesSortMenu value="date-desc" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Sort by" });
    trigger.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("date-asc");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes with Escape without changing the sort option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<NotesSortMenu value="date-desc" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Sort by" });
    trigger.focus();
    await user.keyboard("{Enter}{End}{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
