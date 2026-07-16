import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "@/components/ui/Combobox";

const options = ["Arial", "Georgia", "Helvetica", "Times New Roman"];

describe("Combobox", () => {
  describe("rendering", () => {
    it("renders an input element with combobox role", () => {
      render(<Combobox value="Arial" onChange={() => {}} options={options} ariaLabel="Font" />);
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("displays the current value when closed", () => {
      render(<Combobox value="Georgia" onChange={() => {}} options={options} ariaLabel="Font" />);
      const input = screen.getByRole("combobox") as HTMLInputElement;
      expect(input.value).toBe("Georgia");
    });

    it("renders a placeholder when provided", () => {
      render(
        <Combobox
          value=""
          onChange={() => {}}
          options={options}
          placeholder="Select font..."
          ariaLabel="Font"
        />
      );
      expect(screen.getByPlaceholderText("Select font...")).toBeInTheDocument();
    });
  });

  describe("filtering", () => {
    it("filters options as user types", async () => {
      const user = userEvent.setup();
      render(<Combobox value="" onChange={() => {}} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "Hel");

      expect(screen.getByText("Helvetica")).toBeInTheDocument();
      expect(screen.queryByText("Arial")).not.toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("calls onChange when an option is selected", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} ariaLabel="Font" />);

      const button = screen.getByRole("button");
      await user.click(button);

      const georgiaOption = await screen.findByText("Georgia");
      await user.click(georgiaOption);

      expect(onChange).toHaveBeenCalledWith("Georgia");
    });
  });

  describe("custom value", () => {
    it("shows custom value option when typing a non-matching value", async () => {
      const user = userEvent.setup();
      render(<Combobox value="" onChange={() => {}} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "CustomFont");

      expect(screen.getByText('"CustomFont"')).toBeInTheDocument();
    });

    it("accepts custom value via Enter key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "MyFont");
      await user.keyboard("{Enter}");

      expect(onChange).toHaveBeenCalledWith("MyFont");
    });

    it("accepts custom value via the numpad Enter key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "MyFont");
      await user.keyboard("{NumpadEnter}");

      expect(onChange).toHaveBeenCalledWith("MyFont");
    });
  });

  describe("keyboard navigation", () => {
    it("selects the highlighted option with the arrow keys and Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

      expect(onChange).toHaveBeenCalledWith("Georgia");
    });
  });

  describe("divider", () => {
    it("renders separator for divider options", async () => {
      const user = userEvent.setup();
      const optionsWithDivider = ["Arial", "divider", "Courier"];

      render(
        <Combobox value="" onChange={() => {}} options={optionsWithDivider} ariaLabel="Font" />
      );

      const button = screen.getByRole("button");
      await user.click(button);

      await screen.findByText("Arial");
      expect(screen.getByRole("separator")).toBeInTheDocument();
    });
  });
});
