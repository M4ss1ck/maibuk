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

  it("closes the dropdown when Tab moves focus past it, skipping its options", async () => {
    const user = userEvent.setup();

    render(
      <>
        <MultiSelectCombobox value={[]} onChange={() => {}} options={options} />
        <button type="button">Next field</button>
      </>
    );

    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("checkbox", { name: "research" })).toBeInTheDocument();

    await user.tab();

    expect(screen.getByRole("button", { name: "Next field" })).toHaveFocus();
    expect(screen.queryByRole("checkbox", { name: "research" })).not.toBeInTheDocument();
  });

  it("ArrowDown opens the list and walks its options; Space toggles one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<MultiSelectCombobox value={[]} onChange={onChange} options={options} />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "draft" })).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("checkbox", { name: "draft" })).toHaveFocus();

    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("checkbox", { name: "research" })).toHaveFocus();

    await user.keyboard("{ArrowUp} ");
    expect(screen.getByRole("checkbox", { name: "ideas" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith(["ideas"]);
  });

  it("Escape in the list closes it and returns focus to the input, list still closed", async () => {
    const user = userEvent.setup();

    render(<MultiSelectCombobox value={[]} onChange={() => {}} options={options} />);
    await user.click(screen.getByRole("combobox"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("checkbox", { name: "draft" })).toHaveFocus();

    await user.keyboard("{Escape}");

    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.queryByRole("checkbox", { name: "draft" })).not.toBeInTheDocument();
  });

  it("Escape closes only an open list; with the list closed it reaches the parent", async () => {
    const user = userEvent.setup();
    const onParentKeyDown = vi.fn();

    render(
      <div onKeyDown={(event) => onParentKeyDown(event.key)}>
        <MultiSelectCombobox value={[]} onChange={() => {}} options={options} />
      </div>
    );
    await user.click(screen.getByRole("combobox"));

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "draft" })).not.toBeInTheDocument();
    expect(onParentKeyDown).not.toHaveBeenCalledWith("Escape");

    await user.keyboard("{Escape}");
    expect(onParentKeyDown).toHaveBeenCalledWith("Escape");
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
