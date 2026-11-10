import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Slider } from "@/components/ui/Slider";

function TestSlider({ onChange }: { onChange?: (value: number) => void }) {
  const [value, setValue] = useState(50);
  return (
    <Slider
      label="Strength"
      value={value}
      minValue={0}
      maxValue={100}
      step={1}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe("Slider", () => {
  it("shows its label and current value", () => {
    render(<TestSlider />);
    expect(screen.getByText("Strength")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Strength" })).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("steps with the arrow keys", async () => {
    const user = userEvent.setup();
    const seen: number[] = [];
    render(<TestSlider onChange={(value) => seen.push(value)} />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(seen).toEqual([51]);
    expect(screen.getByText("51")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(seen).toEqual([51, 50]);
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("jumps to the minimum and maximum with Home and End", async () => {
    const user = userEvent.setup();
    const seen: number[] = [];
    render(<TestSlider onChange={(value) => seen.push(value)} />);
    await user.tab();
    await user.keyboard("{Home}");
    expect(seen).toEqual([0]);
    expect(screen.getByText("0")).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(seen).toEqual([0, 100]);
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("moves by a page with PageUp and PageDown", async () => {
    const user = userEvent.setup();
    const seen: number[] = [];
    render(<TestSlider onChange={(value) => seen.push(value)} />);
    await user.tab();
    await user.keyboard("{PageUp}");
    expect(seen).toEqual([60]);
    await user.keyboard("{PageDown}");
    expect(seen).toEqual([60, 50]);
  });
});
