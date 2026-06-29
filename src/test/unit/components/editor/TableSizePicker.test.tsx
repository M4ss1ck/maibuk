import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TableSizePicker } from "@/components/editor/TableSizePicker";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("TableSizePicker", () => {
  it("reports the hovered dimensions and the header-row preference on select", () => {
    const onSelect = vi.fn();
    render(<TableSizePicker onSelect={onSelect} />);
    const cell = screen.getByTestId("table-size-3-4");
    fireEvent.mouseEnter(cell);
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenCalledWith(3, 4, true);
  });

  it("reflects toggling the header-row switch off", () => {
    const onSelect = vi.fn();
    render(<TableSizePicker onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByTestId("table-size-2-2"));
    expect(onSelect).toHaveBeenCalledWith(2, 2, false);
  });
});
