import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

const { i18nState } = vi.hoisted(() => ({
  i18nState: { language: "en" as "en" | "es" },
}));

const translations = {
  en: {
    "common.increaseValue": "Increase value",
    "common.decreaseValue": "Decrease value",
  },
  es: {
    "common.increaseValue": "Incrementar valor",
    "common.decreaseValue": "Reducir valor",
  },
} as const;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const lang = i18nState.language;
      return (translations as Record<string, Record<string, string>>)[lang]?.[key] ?? key;
    },
  }),
}));

import { Input } from "@/components/ui/Input";

describe("Input", () => {
  beforeEach(() => {
    i18nState.language = "en";
  });

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

    it("labels the input and describes its error when neither id nor name is given", () => {
      render(<Input label="Book Title" error="Title is required" />);
      const input = screen.getByRole("textbox", { name: "Book Title" });
      expect(input).toHaveAccessibleDescription("Title is required");
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

    it("announces the error as the input's description", () => {
      render(<Input id="folder" label="Folder" error="Use a full path" aria-describedby="hint" />);
      const input = screen.getByRole("textbox", { name: "Folder" });

      expect(input).toHaveAccessibleDescription("Use a full path");
      expect(input).toBeInvalid();
      expect(input.getAttribute("aria-describedby")).toBe("hint folder-error");
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
    it("renders themed step controls for number inputs with English names", () => {
      render(<Input type="number" />);

      const input = screen.getByRole("spinbutton");
      expect(input.className).toContain("[appearance:textfield]");
      expect(screen.getByRole("button", { name: "Increase value" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Decrease value" })).toBeInTheDocument();
    });

    it("renders themed step controls for number inputs with Spanish names", () => {
      i18nState.language = "es";
      render(<Input type="number" />);

      expect(screen.getByRole("button", { name: "Incrementar valor" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reducir valor" })).toBeInTheDocument();
    });

    it("steps the input value when themed controls are clicked", async () => {
      const user = userEvent.setup();
      render(<Input type="number" defaultValue="1" step="2" />);

      await user.click(screen.getByRole("button", { name: "Increase value" }));
      expect(screen.getByRole("spinbutton")).toHaveValue(3);

      await user.click(screen.getByRole("button", { name: "Decrease value" }));
      expect(screen.getByRole("spinbutton")).toHaveValue(1);
    });

    it("steps the input value via keyboard when themed controls are focused and activated", async () => {
      const user = userEvent.setup();
      i18nState.language = "es";
      render(<Input type="number" defaultValue="5" step="1" />);

      const incBtn = screen.getByRole("button", { name: "Incrementar valor" });
      const decBtn = screen.getByRole("button", { name: "Reducir valor" });

      incBtn.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("spinbutton")).toHaveValue(6);

      decBtn.focus();
      await user.keyboard("{Enter}");
      expect(screen.getByRole("spinbutton")).toHaveValue(5);
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

    // Regression: a Dictation Language tab swap hands one object ref from the
    // Input that unmounts to the Input that takes its place, and the survivor
    // attaches first (its element is reused, so React does not re-attach it).
    // The unmounting Input's detach must not clear a ref that already points at
    // the new node, or the record button focuses a field that is not there.
    it("keeps a shared object ref on the replacement input when the old one unmounts", () => {
      const sharedRef = { current: null as HTMLInputElement | null };
      const a = <Input key="a" ref={sharedRef} aria-label="a" />;
      const b = <Input key="b" ref={sharedRef} aria-label="b" />;
      const { rerender } = render(
        <>
          {a}
          {b}
        </>
      );
      expect(sharedRef.current).toBe(screen.getByLabelText("b"));

      // A unmounts in this commit; B is the same element, so it does not attach again.
      rerender(b);

      expect(sharedRef.current).toBe(screen.getByLabelText("b"));
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
