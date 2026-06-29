import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MultiSelectCombobox } from "@/components/ui/MultiSelectCombobox";

const options = ["draft", "ideas", "research"];

describe("MultiSelectCombobox", () => {
  it("opens the dropdown when the input is clicked", async () => {
    const user = userEvent.setup();

    render(
      <MultiSelectCombobox value={[]} onChange={() => {}} options={options} placeholder="Any tag" />
    );

    await user.click(screen.getByRole("combobox"));

    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("ideas")).toBeInTheDocument();
  });

  it("keeps the dropdown open when an item checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<MultiSelectCombobox value={[]} onChange={onChange} options={options} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("checkbox", { name: "ideas" }));

    expect(onChange).toHaveBeenCalledWith(["ideas"]);
    expect(screen.getByText("research")).toBeInTheDocument();
  });

  it("closes the dropdown when an item label is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<MultiSelectCombobox value={[]} onChange={onChange} options={options} />);

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: "ideas" }));

    expect(onChange).toHaveBeenCalledWith(["ideas"]);
    expect(screen.queryByText("research")).not.toBeInTheDocument();
  });

  it("adds a custom value with Enter when custom values are enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <MultiSelectCombobox value={["draft"]} onChange={onChange} options={options} allowCustom />
    );

    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "plot{Enter}");

    expect(onChange).toHaveBeenCalledWith(["draft", "plot"]);
    expect(screen.queryByText('"plot"')).not.toBeInTheDocument();
  });

  it("removes selected values from their chips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <MultiSelectCombobox
        value={["draft", "ideas"]}
        onChange={onChange}
        options={options}
        removeLabel={(tag) => `Remove ${tag}`}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove draft" }));

    expect(onChange).toHaveBeenCalledWith(["ideas"]);
  });

  it("exposes the text input through its ref", () => {
    const inputRef = createRef<HTMLInputElement>();

    render(<MultiSelectCombobox ref={inputRef} value={[]} onChange={() => {}} options={options} />);

    inputRef.current?.focus();

    expect(screen.getByRole("combobox")).toHaveFocus();
  });
});
