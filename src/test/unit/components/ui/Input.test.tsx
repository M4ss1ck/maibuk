import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { Input } from "../../../../components/ui/Input";

describe("Input", () => {
  describe("rendering", () => {
    it("renders an input element", () => {
      render(<Input />);
      expect(screen.getByRole("textbox")).toBeInTheDocument();
    });

    it("renders with a placeholder", () => {
      render(<Input placeholder="Enter text..." />);
      expect(screen.getByPlaceholderText("Enter text...")).toBeInTheDocument();
    });
  });

  describe("label", () => {
    it("renders a label when provided", () => {
      render(<Input label="Email" id="email" />);
      expect(screen.getByLabelText("Email")).toBeInTheDocument();
    });

    it("associates label with input via htmlFor", () => {
      render(<Input label="Name" id="name-input" />);
      const input = screen.getByLabelText("Name");
      expect(input).toHaveAttribute("id", "name-input");
    });

    it("uses name as fallback id when no id provided", () => {
      render(<Input label="Field" name="my-field" />);
      const input = screen.getByLabelText("Field");
      expect(input).toHaveAttribute("id", "my-field");
    });

    it("does not render label when not provided", () => {
      const { container } = render(<Input />);
      expect(container.querySelector("label")).toBeNull();
    });
  });

  describe("error state", () => {
    it("renders error message when provided", () => {
      render(<Input error="This field is required" />);
      expect(screen.getByText("This field is required")).toBeInTheDocument();
    });

    it("applies destructive border style on error", () => {
      render(<Input error="Error" />);
      const input = screen.getByRole("textbox");
      expect(input.className).toContain("border-destructive");
    });

    it("does not show error message when no error", () => {
      const { container } = render(<Input />);
      expect(container.querySelector(".text-destructive")).toBeNull();
    });
  });

  describe("endAdornment", () => {
    it("renders end adornment when provided", () => {
      render(<Input endAdornment={<span data-testid="icon">🔍</span>} />);
      expect(screen.getByTestId("icon")).toBeInTheDocument();
    });

    it("adds padding for end adornment", () => {
      render(<Input endAdornment={<span>X</span>} />);
      const input = screen.getByRole("textbox");
      expect(input.className).toContain("pr-10");
    });
  });

  describe("number controls", () => {
    it("renders themed step controls for number inputs", () => {
      render(<Input type="number" />);

      const input = screen.getByRole("spinbutton");

      expect(input.className).toContain("[appearance:textfield]");
      expect(screen.getByRole("button", { name: "Increase value" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Decrease value" })).toBeInTheDocument();
    });

    it("steps the input value when themed controls are clicked", async () => {
      const user = userEvent.setup();
      render(<Input type="number" defaultValue="1" step="2" />);

      await user.click(screen.getByRole("button", { name: "Increase value" }));
      expect(screen.getByRole("spinbutton")).toHaveValue(3);

      await user.click(screen.getByRole("button", { name: "Decrease value" }));
      expect(screen.getByRole("spinbutton")).toHaveValue(1);
    });

    it("emits change events when themed controls are clicked", async () => {
      const user = userEvent.setup();
      const handleChange = vi.fn();
      render(<Input type="number" defaultValue="1" onChange={handleChange} />);

      await user.click(screen.getByRole("button", { name: "Increase value" }));

      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it("falls back to whole-number steps when native stepping is unavailable", async () => {
      const user = userEvent.setup();
      render(<Input type="number" defaultValue="1" step="any" />);

      await user.click(screen.getByRole("button", { name: "Increase value" }));
      expect(screen.getByRole("spinbutton")).toHaveValue(2);
    });
  });

  describe("ref forwarding", () => {
    it("forwards ref to the input element", () => {
      const ref = createRef<HTMLInputElement>();
      render(<Input ref={ref} />);

      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });
  });

  describe("HTML attributes", () => {
    it("passes through disabled attribute", () => {
      render(<Input disabled />);
      expect(screen.getByRole("textbox")).toBeDisabled();
    });

    it("passes through value and onChange", () => {
      let value = "";
      render(
        <Input
          value={value}
          onChange={(e) => {
            value = e.target.value;
          }}
        />
      );
      expect(screen.getByRole("textbox")).toHaveValue("");
    });

    it("passes through custom className", () => {
      render(<Input className="custom-class" />);
      const input = screen.getByRole("textbox");
      expect(input.className).toContain("custom-class");
    });
  });
});
