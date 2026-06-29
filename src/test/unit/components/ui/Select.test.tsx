import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "@/components/ui/Select";

const options = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

describe("Select", () => {
  describe("rendering", () => {
    it("renders a listbox button", () => {
      render(<Select value="apple" onChange={() => {}} options={options} />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("displays the selected option label", () => {
      render(<Select value="banana" onChange={() => {}} options={options} />);
      expect(screen.getByText("Banana")).toBeInTheDocument();
    });

    it("renders an end adornment inside the trigger", () => {
      render(<Select value="banana" onChange={() => {}} options={options} endAdornment="/3" />);

      expect(screen.getByRole("button")).toHaveTextContent("Banana/3");
    });

    it("can opt out of the default minimum trigger width", () => {
      render(<Select value="banana" onChange={() => {}} options={options} minWidth="none" />);

      expect(screen.getByRole("button")).not.toHaveClass("min-w-35");
    });
  });

  describe("interaction", () => {
    it("opens dropdown on click", async () => {
      const user = userEvent.setup();
      render(<Select value="apple" onChange={() => {}} options={options} />);

      await user.click(screen.getByRole("button"));

      // All options should be visible as listbox options
      const optionElements = screen.getAllByRole("option");
      expect(optionElements).toHaveLength(3);
      expect(optionElements[0]).toHaveTextContent("Apple");
      expect(optionElements[1]).toHaveTextContent("Banana");
      expect(optionElements[2]).toHaveTextContent("Cherry");
    });

    it("calls onChange when an option is selected", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Select value="apple" onChange={onChange} options={options} />);

      await user.click(screen.getByRole("button"));
      await user.click(screen.getByText("Cherry"));

      expect(onChange).toHaveBeenCalledWith("cherry");
    });
  });

  describe("numeric values", () => {
    it("works with number options", () => {
      const numOptions = [
        { value: 12, label: "12px" },
        { value: 16, label: "16px" },
        { value: 20, label: "20px" },
      ];

      render(<Select value={16} onChange={() => {}} options={numOptions} />);
      expect(screen.getByText("16px")).toBeInTheDocument();
    });
  });

  describe("className", () => {
    it("applies custom className to wrapper", () => {
      const { container } = render(
        <Select value="apple" onChange={() => {}} options={options} className="w-40" />
      );
      // className is applied to the inner div: Listbox > div[data-headlessui-state] > div.relative
      const wrapper = container.querySelector(".w-40");
      expect(wrapper).toBeInTheDocument();
    });
  });
});
