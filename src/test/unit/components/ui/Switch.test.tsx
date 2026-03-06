import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "../../../../components/ui/Switch";

describe("Switch", () => {
  describe("rendering", () => {
    it("renders a switch element", () => {
      render(<Switch checked={false} onChange={() => { }} />);
      expect(screen.getByRole("switch")).toBeInTheDocument();
    });
  });

  describe("checked state", () => {
    it("reflects unchecked state", () => {
      render(<Switch checked={false} onChange={() => { }} />);
      expect(screen.getByRole("switch")).not.toBeChecked();
    });

    it("reflects checked state", () => {
      render(<Switch checked={true} onChange={() => { }} />);
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
  });

  describe("label", () => {
    it("renders a screen-reader label when provided", () => {
      render(<Switch checked={false} onChange={() => { }} label="Enable notifications" />);
      expect(screen.getByRole("switch")).toHaveAccessibleName("Enable notifications");
    });
  });

  describe("className", () => {
    it("appends custom className", () => {
      render(<Switch checked={false} onChange={() => { }} className="my-switch" />);
      const el = screen.getByRole("switch");
      expect(el.className).toContain("my-switch");
    });
  });
});
