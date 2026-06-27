import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { PagePaddingControl } = await import(
  "../../../../components/editor/PagePaddingControl"
);

describe("PagePaddingControl", () => {
  it("renders the simple slider and value", () => {
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("slider")).toHaveAttribute("max", "96");
    expect(screen.getByText("32px")).toBeInTheDocument();
  });

  it("calls onChange with a number when the simple slider moves", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByRole("slider"), { target: { value: "64" } });
    expect(onChange).toHaveBeenCalledWith(64);
  });

  it("shows Custom placeholder when sides differ", () => {
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 48, bottom: 32, left: 32 }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("editor.paddingCustom")).toBeInTheDocument();
  });

  it("expands custom mode and updates a single side", () => {
    const onChange = vi.fn();
    render(
      <PagePaddingControl
        padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("editor.customizePadding"));
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(4);
    fireEvent.change(sliders[0], { target: { value: "48" } });
    expect(onChange).toHaveBeenCalledWith({ top: 48 });
  });
});
