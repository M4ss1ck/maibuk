import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { color?: string }) =>
      options?.color ? `${key} ${options.color}` : key,
  }),
}));

const { ColorPicker } = await import("@/components/editor/ColorPicker");

function renderPicker(onChange = vi.fn()) {
  render(<ColorPicker value="" onChange={onChange} label="Text color" icon={<span>icon</span>} />);
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
    const swatch = screen.getByRole("option", { name: "colorPicker.preset #EF4444" });
    swatch.focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("#EF4444");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("applies black explicitly when the selected text has no color mark", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();
    const trigger = screen.getByRole("button", { name: "editor.colorOptions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const black = screen.getByRole("option", { name: "colorPicker.preset #000000" });
    black.focus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("#000000");
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
