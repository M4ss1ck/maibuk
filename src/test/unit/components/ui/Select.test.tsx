import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "@/components/ui/Select";

const options = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
];

describe("Select", () => {
  describe("rendering", () => {
    it("renders a select button", () => {
      render(<Select value="apple" onChange={() => {}} options={options} ariaLabel="Fruit" />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("displays the selected option label in the button", () => {
      render(<Select value="banana" onChange={() => {}} options={options} ariaLabel="Fruit" />);
      const button = screen.getByRole("button");
      expect(button).toHaveTextContent("Banana");
    });

    it("renders an end adornment inside the trigger", () => {
      render(
        <Select
          value="banana"
          onChange={() => {}}
          options={options}
          endAdornment="/3"
          ariaLabel="Fruit"
        />
      );

      expect(screen.getByRole("button")).toHaveTextContent("Banana/3");
    });

    it("can opt out of the default minimum trigger width", () => {
      render(
        <Select
          value="banana"
          onChange={() => {}}
          options={options}
          minWidth="none"
          ariaLabel="Fruit"
        />
      );

      expect(screen.getByRole("button")).not.toHaveClass("min-w-35");
    });
  });

  describe("interaction", () => {
    it("opens dropdown on click", async () => {
      const user = userEvent.setup();
      render(<Select value="apple" onChange={() => {}} options={options} ariaLabel="Fruit" />);

      await user.click(screen.getByRole("button"));

      const optionElements = screen.getAllByRole("option");
      expect(optionElements).toHaveLength(3);
      expect(optionElements[0]).toHaveTextContent("Apple");
      expect(optionElements[1]).toHaveTextContent("Banana");
      expect(optionElements[2]).toHaveTextContent("Cherry");
    });

    it("calls onChange when an option is selected", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Select value="apple" onChange={onChange} options={options} ariaLabel="Fruit" />);

      await user.click(screen.getByRole("button"));
      const cherryOption = screen
        .getAllByRole("option")
        .find((opt) => opt.textContent === "Cherry")!;
      await user.click(cherryOption);

      expect(onChange).toHaveBeenCalledWith("cherry");
    });

    it("supports keyboard selection and restores focus to the trigger", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Select value="apple" onChange={onChange} options={options} ariaLabel="Fruit" />);

      const trigger = screen.getByRole("button", { name: /Fruit/ });
      trigger.focus();
      await user.keyboard(" ");
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await user.keyboard("{ArrowDown}{Enter}");
      expect(onChange).toHaveBeenCalledWith("banana");
      await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("closes with Escape and returns focus without changing the value", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Select value="apple" onChange={onChange} options={options} ariaLabel="Fruit" />);

      const trigger = screen.getByRole("button", { name: /Fruit/ });
      trigger.focus();
      await user.keyboard("{Enter}{End}{Escape}");

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
    });
  });

  describe("numeric values", () => {
    it("works with number options", () => {
      const numOptions = [
        { value: 12, label: "12px" },
        { value: 16, label: "16px" },
        { value: 20, label: "20px" },
      ];

      render(<Select value={16} onChange={() => {}} options={numOptions} ariaLabel="Size" />);
      expect(screen.getByRole("button")).toHaveTextContent("16px");
    });
  });

  describe("className", () => {
    it("applies custom className to wrapper", () => {
      const { container } = render(
        <Select
          value="apple"
          onChange={() => {}}
          options={options}
          className="w-40"
          ariaLabel="Fruit"
        />
      );
      const wrapper = container.querySelector(".w-40");
      expect(wrapper).toBeInTheDocument();
    });
  });
});
