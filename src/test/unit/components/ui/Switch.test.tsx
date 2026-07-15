import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "@/components/ui/Switch";

describe("Switch", () => {
  describe("rendering", () => {
    it("renders a switch element", () => {
      render(<Switch checked={false} onChange={() => {}} />);
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });
  });

  describe("checked state", () => {
    it("reflects unchecked state", () => {
      render(<Switch checked={false} onChange={() => {}} />);
      expect(screen.getByRole("switch")).not.toBeChecked();
    });

    it("reflects checked state", () => {
      render(<Switch checked={true} onChange={() => {}} />);
      expect(screen.getByRole("switch")).toBeChecked();
    });
  });

  describe("interaction", () => {
    it("calls onChange with toggled value when clicked", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Switch checked={false} onChange={onChange} />);

      await user.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(true);
    });

    it("calls onChange with false when unchecking", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Switch checked={true} onChange={onChange} />);

      await user.click(screen.getByRole("switch"));

      expect(onChange).toHaveBeenCalledWith(false);
    });

    it("toggles with the Space key", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(<Switch checked={false} onChange={onChange} label="Setting" />);

      const control = screen.getByRole("switch", { name: "Setting" });
      control.focus();
      await user.keyboard(" ");

      expect(onChange).toHaveBeenCalledWith(true);
      expect(control).toHaveFocus();
    });
  });

  describe("label", () => {
    it("renders a screen-reader label when provided", () => {
      render(
        <Switch
          checked={false}
          onChange={() => {}}
          label="Enable notifications"
        />,
      );
      expect(
        screen.getByRole("switch"),
      ).toHaveAccessibleName("Enable notifications");
    });
  });

  describe("className", () => {
    it("appends custom className to the switch button label", () => {
      render(
        <Switch
          checked={false}
          onChange={() => {}}
          className="my-switch"
        />,
      );
      const input = screen.getByRole("switch");
      const label = input.closest("label");
      expect(label).not.toBeNull();
      expect(label!.className).toContain("my-switch");
    });
  });

  describe("disabled", () => {
    it("does not call onChange when disabled", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <Switch
          checked={false}
          onChange={onChange}
          disabled={true}
        />,
      );

      await user.click(screen.getByRole("switch"));

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
