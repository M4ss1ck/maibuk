import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      ({
        "books.filterByStatus": "Filter by status",
        "books.allStatuses": "All statuses",
        "books.statusCount": `${options?.count} statuses`,
        "common.draft": "Draft",
        "common.in-progress": "In Progress",
        "common.completed": "Completed",
        "common.archived": "Archived",
      })[key] ?? key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

import { BookStatusFilter } from "@/components/project/BookStatusFilter";
import type { BookStatus } from "@/features/books/types";

const counts = { draft: 2, "in-progress": 1, completed: 0, archived: 3 };

function renderFilter(value: BookStatus[], onChange = vi.fn()) {
  render(<BookStatusFilter value={value} counts={counts} onChange={onChange} />);
  return { onChange, trigger: screen.getByRole("button", { name: /Filter by status/i }) };
}

describe("BookStatusFilter", () => {
  it("opens from the keyboard and lists every status with its count", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["draft"]);

    trigger.focus();
    await user.keyboard("{Enter}");

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Draft2",
      "In Progress1",
      "Completed0",
      "Archived3",
    ]);
  });

  it("marks the selected statuses as selected", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["draft", "archived"]);

    trigger.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("option", { name: /Draft/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("option", { name: /Completed/ })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });

  it("stays open while toggling a status so several can be picked in one visit", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderFilter(["draft"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await user.click(screen.getByRole("option", { name: /Archived/ }));

    expect(onChange).toHaveBeenCalledWith(["draft", "archived"]);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("deselects an already selected status", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderFilter(["draft", "completed"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("option", { name: /Draft/ }));

    expect(onChange).toHaveBeenCalledWith(["completed"]);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["draft"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("summarises the current selection on the trigger", () => {
    const { trigger } = renderFilter(["completed"]);
    expect(trigger).toHaveTextContent("Completed");
  });

  it("says all statuses when nothing is filtered out", () => {
    const { trigger } = renderFilter(["draft", "in-progress", "completed", "archived"]);
    expect(trigger).toHaveTextContent("All statuses");
  });

  it("counts the selection when it is a partial set", () => {
    const { trigger } = renderFilter(["draft", "in-progress", "completed"]);
    expect(trigger).toHaveTextContent("3 statuses");
  });
});
