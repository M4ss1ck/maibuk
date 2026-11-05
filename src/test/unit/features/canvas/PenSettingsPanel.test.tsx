import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setPenWidth: vi.fn(),
  setPenColor: vi.fn(),
}));

vi.mock("@/features/canvas/store", () => ({
  useCanvasStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      penWidth: 3,
      penColor: "#ef4444",
      setPenWidth: mocks.setPenWidth,
      setPenColor: mocks.setPenColor,
    }),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PenSettingsPanel } = await import("@/features/canvas/PenSettingsPanel");

afterEach(() => {
  document.documentElement.style.removeProperty("--color-background");
});

describe("PenSettingsPanel", () => {
  it("never announces an unknown contrast color when the pen picker opens", async () => {
    const user = userEvent.setup();
    document.documentElement.style.setProperty("--color-background", "#FFFFFF");
    render(<PenSettingsPanel />);

    screen.getByRole("button", { name: "canvas.penColor" }).focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog", { name: "canvas.penColor" });

    expect(screen.queryByText("colorPicker.unknownContrast")).not.toBeInTheDocument();
  });

  it("warns when the pen color disappears into the theme background", async () => {
    const user = userEvent.setup();
    document.documentElement.style.setProperty("--color-background", "#FFFFFF");
    render(<PenSettingsPanel />);

    screen.getByRole("button", { name: "canvas.penColor" }).focus();
    await user.keyboard("{Enter}");
    const field = await screen.findByRole("textbox", { name: "colorPicker.hexValue" });
    await user.clear(field);
    await user.type(field, "#FFFFFF{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("colorPicker.lowContrast");
  });
});
