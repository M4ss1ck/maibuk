import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Combobox } from "@/components/ui/Combobox";

const options = ["Arial", "Georgia", "Helvetica", "Times New Roman"];

describe("Combobox", () => {
  describe("rendering", () => {
    it("renders an input element", () => {
      render(<Combobox value="Arial" onChange={() => {}} options={options} />);
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    });

    it("displays the current value", () => {
      render(<Combobox value="Georgia" onChange={() => {}} options={options} />);
      expect(screen.getByRole("combobox")).toHaveValue("Georgia");
    });

    it("renders a placeholder when provided", () => {
      render(
        <Combobox value="" onChange={() => {}} options={options} placeholder="Select font..." />
      );
      expect(screen.getByPlaceholderText("Select font...")).toBeInTheDocument();
    });
  });

  describe("filtering", () => {
    it("filters options as user types", async () => {
      const user = userEvent.setup();
      render(<Combobox value="" onChange={() => {}} options={options} />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "Hel");

      // Helvetica should be visible, Arial should be filtered out
      expect(screen.getByText("Helvetica")).toBeInTheDocument();
      expect(screen.queryByText("Arial")).not.toBeInTheDocument();
    });
  });

  describe("selection", () => {
    it("calls onChange when an option is selected", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} />);

      // Click the chevron button to open the dropdown
      const button = screen.getByRole("button");
      await user.click(button);

      await user.click(await screen.findByText("Georgia"));

      expect(onChange).toHaveBeenCalledWith("Georgia");
    });
  });

  describe("custom value", () => {
    it("shows custom value option when typing a non-matching value", async () => {
      const user = userEvent.setup();
      render(<Combobox value="" onChange={() => {}} options={options} />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "CustomFont");

      expect(screen.getByText('"CustomFont"')).toBeInTheDocument();
    });

    it("accepts custom value via Enter key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "MyFont{Enter}");

      expect(onChange).toHaveBeenCalledWith("MyFont");
    });

    it("accepts custom value via the numpad Enter key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.type(input, "MyFont");
      await user.keyboard("[NumpadEnter]");

      expect(onChange).toHaveBeenCalledWith("MyFont");
    });
  });

  describe("keyboard navigation", () => {
    it("selects the highlighted option with the arrow keys and Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="" onChange={onChange} options={options} />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");

      expect(onChange).toHaveBeenCalledWith("Georgia");
    });
  });

  describe("divider", () => {
    it("renders hr for divider options", async () => {
      const user = userEvent.setup();
      const optionsWithDivider = ["Arial", "divider", "Courier"];

      render(<Combobox value="" onChange={() => {}} options={optionsWithDivider} />);

      // Click the button to open the dropdown (portal-rendered)
      const button = screen.getByRole("button");
      await user.click(button);

      // Wait for options to render, then check for hr in the document body
      await screen.findByText("Arial");
      const hrs = document.body.querySelectorAll("hr");
      expect(hrs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
