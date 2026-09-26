import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ColorPickerControl } from "@/components/ui/ColorPickerControl";
import { installPointerEvent, touchTap } from "@/test/support/pointer-events";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { color?: string }) =>
      options?.color ? `${key} ${options.color}` : key,
  }),
}));

beforeAll(installPointerEvent);

describe("ColorPickerControl", () => {
  it("previews a keyboard area adjustment and commits when it ends", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <ColorPickerControl
        label="Accent"
        value="#3B82F6"
        onPreview={onPreview}
        onCommit={onCommit}
      />
    );
    screen.getByRole("button", { name: "Accent" }).focus();
    await user.keyboard("{Enter}");
    const area = await screen.findByRole("slider", { name: /colorPicker.area/ });
    area.focus();
    await user.keyboard("{ArrowLeft}");
    await user.keyboard("{ArrowUp}");
    expect(onPreview).toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("commits a valid hex edit by keyboard and keeps invalid text editable", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ColorPickerControl label="Accent" value="#3B82F6" onCommit={onCommit} />);

    const trigger = screen.getByRole("button", { name: "Accent" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    expect(field).toHaveAccessibleName("colorPicker.hexValue");
    await user.clear(field);
    await user.type(field, "#12");
    await user.keyboard("{Enter}");
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue("#12");

    await user.clear(field);
    await user.type(field, "#f50");
    await user.keyboard("{Enter}");
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("#FF5500"));
  });

  it("previews and commits a keyboard hue adjustment once", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <ColorPickerControl
        label="Accent"
        value="#3B82F6"
        onPreview={onPreview}
        onCommit={onCommit}
      />
    );
    screen.getByRole("button", { name: "Accent" }).focus();
    await user.keyboard("{Enter}");
    const hue = await screen.findByRole("slider", { name: /colorPicker.hue/ });
    hue.focus();
    await user.keyboard("{ArrowRight}");
    expect(onPreview).toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("warns for a known low-contrast pair while allowing the color", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ColorPickerControl
        label="Text"
        value="#FFFFFF"
        contrastAgainst="#FFFFFF"
        onCommit={onCommit}
      />
    );
    screen.getByRole("button", { name: "Text" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("colorPicker.lowContrast");
    const field = screen.getByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#eeeeee{Enter}");
    expect(onCommit).toHaveBeenCalledWith("#EEEEEE");
  });

  it("announces when contrast cannot be checked", async () => {
    const user = userEvent.setup();
    render(
      <ColorPickerControl label="Cover" value="#FFFFFF" showUnknownContrast onCommit={vi.fn()} />
    );
    screen.getByRole("button", { name: "Cover" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("colorPicker.unknownContrast");
  });

  it("uses the 3:1 threshold for meaningful graphics", async () => {
    const user = userEvent.setup();
    render(
      <ColorPickerControl
        label="Stroke"
        value="#777777"
        contrastAgainst="#FFFFFF"
        contrastKind="non-text"
        onCommit={vi.fn()}
      />
    );
    screen.getByRole("button", { name: "Stroke" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("selects a preset by pointer", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ColorPickerControl label="Accent" value="#3B82F6" onCommit={onCommit} />);
    const trigger = screen.getByRole("button", { name: "Accent" });
    await user.click(trigger);
    const preset = await screen.findByRole("option", { name: "colorPicker.preset #EF4444" });
    await user.click(preset);
    expect(onCommit).toHaveBeenCalledWith("#EF4444");
  });

  it("restores focus to the trigger when Escape closes the picker", async () => {
    const user = userEvent.setup();
    render(<ColorPickerControl label="Accent" value="#3B82F6" onCommit={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Accent" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "Accent" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("commits valid hex on blur and clears the area preview on Escape", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <ColorPickerControl
        label="Accent"
        value="#3B82F6"
        onPreview={onPreview}
        onCommit={onCommit}
      />
    );
    const trigger = screen.getByRole("button", { name: "Accent" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#abc123");
    await user.tab();
    expect(onCommit).toHaveBeenCalledWith("#ABC123");
    const area = screen.getByRole("slider", { name: /colorPicker.area/ });
    area.focus();
    await user.keyboard("{ArrowRight}");
    expect(onPreview).toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("Escape from an edited hex field cancels without committing", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ColorPickerControl label="Accent" value="#3B82F6" onCommit={onCommit} />);
    screen.getByRole("button", { name: "Accent" }).focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#ABC123");
    await user.keyboard("{Escape}");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the fallback shade when the stored color is automatic", async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <ColorPickerControl label="Background" value="" fallbackColor="#FFFFFF" onCommit={onCommit} />
    );
    screen.getByRole("button", { name: "Background" }).focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    expect(field).toHaveValue("#FFFFFF");
    await user.click(field);
    await user.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith("#FFFFFF");
  });

  it("opens and commits a preset by touch", async () => {
    const onCommit = vi.fn();
    render(<ColorPickerControl label="Accent" value="#3B82F6" onCommit={onCommit} />);
    touchTap(screen.getByRole("button", { name: "Accent" }));
    const preset = await screen.findByRole("option", { name: "colorPicker.preset #EF4444" });
    touchTap(preset);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("#EF4444");
  });
});
