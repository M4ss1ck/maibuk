import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "@/components/ui/Checkbox";

describe("Checkbox", () => {
  it("exposes a checkbox named by its label", () => {
    render(<Checkbox checked={false} onChange={() => {}} label="Select row" />);
    expect(screen.getByRole("checkbox", { name: "Select row" })).toBeInTheDocument();
  });

  it("reflects the checked state", () => {
    const { rerender } = render(<Checkbox checked={false} onChange={() => {}} label="Row" />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();

    rerender(<Checkbox checked onChange={() => {}} label="Row" />);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("reports the mixed state when indeterminate", () => {
    render(<Checkbox checked={false} indeterminate onChange={() => {}} label="All" />);
    expect(screen.getByRole("checkbox")).toBePartiallyChecked();
  });

  it("toggles on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Row" />);

    await user.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is reachable with Tab and toggles with Space", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked onChange={onChange} label="Row" />);

    await user.tab();
    expect(screen.getByRole("checkbox")).toHaveFocus();
    await user.keyboard(" ");

    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not toggle when disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Row" disabled />);

    await user.click(screen.getByRole("checkbox"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});
