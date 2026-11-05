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

    it("calls onChange when the value it already holds is picked from the list", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      // A pick with the field focused is the author's own change, even when it
      // repeats the held value; only a blur re-commit is skipped (that is what
      // `SelectionToolbar` relies on).
      render(<Combobox value="Arial" onChange={onChange} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{ArrowDown}{Enter}");

      expect(onChange).toHaveBeenCalledWith("Arial");
    });
  });

  describe("explicit commit only", () => {
    it("does not call onChange when Escape discards typing", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <Combobox
          value="Arial"
          onChange={onChange}
          options={options}
          ariaLabel="Font"
          explicitCommitOnly
        />
      );

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}Hel");
      expect(screen.getByRole("listbox")).toBeInTheDocument();

      await user.keyboard("{Escape}");

      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveValue("Arial");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("does not call onChange when a field holding a value is blurred", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <>
          <Combobox
            value="Arial"
            onChange={onChange}
            options={options}
            ariaLabel="Font"
            explicitCommitOnly
          />
          <input aria-label="Elsewhere" />
        </>
      );

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}Hel");
      await user.click(screen.getByLabelText("Elsewhere"));

      expect(onChange).not.toHaveBeenCalled();
    });

    it("calls onChange once on Enter and leaves the list closed", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <Combobox
          value="Arial"
          onChange={onChange}
          options={options}
          ariaLabel="Font"
          explicitCommitOnly
        />
      );

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}Georgia");
      await user.keyboard("{Enter}");

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("Georgia");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("leaves the default commit behavior alone when off", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Combobox value="Arial" onChange={onChange} options={options} ariaLabel="Font" />);

      const input = screen.getByRole("combobox");
      await user.click(input);
      await user.keyboard("{Control>}a{/Control}Hel");
      await user.keyboard("{Escape}");

      // Without explicitCommitOnly, React Aria commits the held value on the
      // revert, as it always has.
      expect(onChange).toHaveBeenCalledWith("Arial");
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
