import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MultiSelectFilter, type MultiSelectFilterOption } from "@/components/ui/MultiSelectFilter";

type Kind = "alpha" | "beta" | "gamma";

const options: readonly MultiSelectFilterOption<Kind>[] = [
  { id: "alpha", label: "Alpha" },
  { id: "beta", label: "Beta" },
  { id: "gamma", label: "Gamma" },
];

const counts: Record<Kind, number> = { alpha: 3, beta: 1, gamma: 0 };

type User = ReturnType<typeof userEvent.setup>;

function renderFilter(value: Kind[], onChange = vi.fn()) {
  render(
    <MultiSelectFilter
      label="Filter by kind"
      options={options}
      value={value}
      counts={counts}
      onChange={onChange}
      allLabel="All kinds"
      countLabel={(count) => `${count} kinds`}
    />
  );
  return { onChange, trigger: screen.getByRole("button", { name: /Filter by kind/i }) };
}

/** ArrowDown until the option owns focus, then assert it. */
async function focusOption(user: User, option: HTMLElement) {
  for (let i = 0; i < options.length + 1 && document.activeElement !== option; i++) {
    await user.keyboard("{ArrowDown}");
  }
  expect(option).toHaveFocus();
}

describe("MultiSelectFilter", () => {
  it("opens from the keyboard and lists every option with its count", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["alpha"]);

    trigger.focus();
    await user.keyboard("{Enter}");

    const optionElements = await screen.findAllByRole("option");
    expect(optionElements.map((option) => option.textContent)).toEqual([
      "Alpha3",
      "Beta1",
      "Gamma0",
    ]);
  });

  it("toggles an unselected option, reporting the set of chosen ids in options order", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderFilter(["alpha"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await focusOption(user, screen.getByRole("option", { name: /Beta/ }));
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith(["alpha", "beta"]);
  });

  it("deselects an already selected option, reporting none selected", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderFilter(["alpha"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await focusOption(user, screen.getByRole("option", { name: /Alpha/ }));
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("selects an option when nothing is selected", async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderFilter([]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await focusOption(user, screen.getByRole("option", { name: /Gamma/ }));
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith(["gamma"]);
  });

  it("stays open while toggling so several options can be picked in one visit", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["alpha"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await focusOption(user, screen.getByRole("option", { name: /Beta/ }));
    await user.keyboard(" ");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    const { trigger } = renderFilter(["alpha"]);

    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("summarises a single selection with its label", () => {
    const { trigger } = renderFilter(["beta"]);
    expect(trigger).toHaveTextContent("Beta");
  });

  it("summarises a partial selection with the caller's count label", () => {
    const { trigger } = renderFilter(["alpha", "beta"]);
    expect(trigger).toHaveTextContent("2 kinds");
  });

  it("says all when every option is selected", () => {
    const { trigger } = renderFilter(["alpha", "beta", "gamma"]);
    expect(trigger).toHaveTextContent("All kinds");
  });
});
