import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { ColorPicker } = await import("@/components/editor/ColorPicker");

function renderPicker(onChange = vi.fn()) {
  render(
    <ColorPicker
      value=""
      onChange={onChange}
      label="Text color"
      icon={<span>icon</span>}
    />
  );
  return onChange;
}

describe("ColorPicker", () => {
  it("opens the palette from the keyboard", async () => {
    const user = userEvent.setup();
    renderPicker();

    const trigger = screen.getByRole("button", { name: "editor.colorOptions" });
    trigger.focus();
    await user.keyboard("{Enter}");

    const palette = await screen.findByRole("dialog", { name: "editor.colorOptions" });
    expect(palette.contains(document.activeElement)).toBe(true);
  });

  it("reports the active mark on the toggle button", () => {
    render(
      <ColorPicker
        value="#ef4444"
        onChange={vi.fn()}
        isActive
        label="Highlight"
        icon={<span>icon</span>}
      />
    );

    expect(screen.getByRole("button", { name: "Highlight" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("applies a preset color chosen by keyboard and closes", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    const trigger = screen.getByRole("button", { name: "editor.colorOptions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const swatch = screen.getByRole("button", { name: "#EF4444" });
    swatch.focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("#EF4444");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    renderPicker();

    const trigger = screen.getByRole("button", { name: "editor.colorOptions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "editor.colorOptions" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
