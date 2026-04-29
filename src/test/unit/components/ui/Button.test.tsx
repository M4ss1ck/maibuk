import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { Button } from "../../../../components/ui/Button";

describe("Button", () => {
  describe("rendering", () => {
    it("renders children text", () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
    });

    it("renders as a button element", () => {
      render(<Button>Test</Button>);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });
  });

  describe("variants", () => {
    it("applies primary variant styles by default", () => {
      render(<Button>Primary</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-primary");
    });

    it("applies secondary variant styles", () => {
      render(<Button variant="secondary">Secondary</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-muted");
    });

    it("applies ghost variant styles", () => {
      render(<Button variant="ghost">Ghost</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-transparent");
    });

    it("applies destructive variant styles", () => {
      render(<Button variant="destructive">Delete</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("bg-destructive");
    });
  });

  describe("sizes", () => {
    it("applies md size by default", () => {
      render(<Button>Medium</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("px-4");
      expect(btn.className).toContain("py-2");
    });

    it("applies sm size", () => {
      render(<Button size="sm">Small</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("px-3");
      expect(btn.className).toContain("py-1.5");
    });

    it("applies lg size", () => {
      render(<Button size="lg">Large</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("px-6");
      expect(btn.className).toContain("py-3");
    });
  });

  describe("disabled state", () => {
    it("renders as disabled when prop is set", () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole("button")).toBeDisabled();
    });

    it("is not disabled by default", () => {
      render(<Button>Enabled</Button>);
      expect(screen.getByRole("button")).not.toBeDisabled();
    });
  });

  describe("interaction", () => {
    it("calls onClick handler when clicked", async () => {
      const user = userEvent.setup();
      let clicked = false;
      render(
        <Button
          onClick={() => {
            clicked = true;
          }}
        >
          Click
        </Button>
      );

      await user.click(screen.getByRole("button"));

      expect(clicked).toBe(true);
    });

    it("does not call onClick when disabled", async () => {
      const user = userEvent.setup();
      let clicked = false;
      render(
        <Button
          disabled
          onClick={() => {
            clicked = true;
          }}
        >
          Click
        </Button>
      );

      await user.click(screen.getByRole("button"));

      expect(clicked).toBe(false);
    });
  });

  describe("ref forwarding", () => {
    it("forwards ref to the button element", () => {
      const ref = createRef<HTMLButtonElement>();
      render(<Button ref={ref}>Ref</Button>);

      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
      expect(ref.current?.textContent).toBe("Ref");
    });
  });

  describe("custom className", () => {
    it("appends custom className to existing styles", () => {
      render(<Button className="my-custom">Custom</Button>);
      const btn = screen.getByRole("button");
      expect(btn.className).toContain("my-custom");
      expect(btn.className).toContain("bg-primary");
    });
  });

  describe("HTML attributes", () => {
    it("passes through type attribute", () => {
      render(<Button type="submit">Submit</Button>);
      expect(screen.getByRole("button")).toHaveAttribute("type", "submit");
    });

    it("passes through aria attributes", () => {
      render(<Button aria-label="Close dialog">X</Button>);
      expect(screen.getByLabelText("Close dialog")).toBeInTheDocument();
    });
  });
});
